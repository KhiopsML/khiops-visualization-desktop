/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ElectronService } from './electron.service';
import { FileSystemService } from './file-system.service';
import { LibVersionService } from './lib-version.service';
import { ConfigService } from './config.service';
import { StorageService } from './storage.service';
import { TabManagerService } from './tab-manager.service';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MenuService {
  private currentChannel: string = 'latest';
  private updateInProgress = false;

  // Subject emitted when menu needs to be rebuilt (e.g., after opening file)
  public menuShouldRebuild$ = new Subject<void>();

  constructor(
    private electronService: ElectronService,
    private configService: ConfigService,
    private translate: TranslateService,
    private fileSystemService: FileSystemService,
    private storageService: StorageService,
    private tabManager: TabManagerService,
  ) {
    this.currentChannel = this.storageService.getOne('CHANNEL') || 'latest';

    (async () => {
      try {
        await this.electronService.ipcRenderer?.invoke(
          'launch-check-for-update',
          this.currentChannel,
          10000,
        );
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  setUpdateInProgress(value = false) {
    this.updateInProgress = value;
  }

  setMenu(
    btnUpdate: string = '',
    btnUpdateText: string = '',
    refreshCb: Function | undefined = undefined,
    updateCb: Function | undefined = undefined,
    installCb: Function | undefined = undefined,
    activeComponent: 'visualization' | 'covisualization' = 'visualization',
  ) {
    const opendFiles = this.fileSystemService.getFileHistory();

    const menuFile = {
      label: this.translate.instant('GLOBAL_MENU_FILE'),
      submenu: [
        {
          label: this.translate.instant('GLOBAL_MENU_OPEN'),
          accelerator: 'CommandOrControl+O',
          click: (_menuItem: any, browserWindow: any) => {
            // browserWindow is the window that had focus when the user clicked
            // the menu item.  Pass its id so the main process targets the
            // correct window even when this closure runs in a different
            // renderer (the one that last called setApplicationMenu).
            this.electronService.ipcRenderer?.invoke(
              'menu-action-open-file',
              browserWindow?.id,
            );
          },
        },
        {
          label: this.translate.instant('GLOBAL_MENU_OPEN_IN_NEW_WINDOW'),
          accelerator: 'CommandOrControl+Shift+O',
          click: () => {
            this.openFileInNewWindow();
          },
        },
        {
          type: 'separator',
        },
        {
          type: 'separator',
        },
        {
          label: this.translate.instant('GLOBAL_MENU_CLOSE_FILE'),
          accelerator: 'CommandOrControl+W',
          enabled: !!(
            this.fileSystemService.currentFilePath &&
            this.fileSystemService.currentFilePath !== ''
          ),
          click: () => {
            this.closeFile(() => {
              refreshCb && refreshCb();
            });
          },
        },
        {
          type: 'separator',
        },
        ...(activeComponent === 'covisualization'
          ? [
              {
                label: this.translate.instant('GLOBAL_MENU_SAVE'),
                accelerator: 'CommandOrControl+S',
                click: () => {
                  this.save();
                },
              },
              {
                label: this.translate.instant('GLOBAL_MENU_SAVE_AS'),
                accelerator: 'CommandOrControl+Shift+S',
                click: () => {
                  this.saveAs();
                },
              },
              {
                label: this.translate.instant(
                  'GLOBAL_MENU_SAVE_CURRENT_HIERARCHY_AS',
                ),
                accelerator: 'CommandOrControl+Shift+Alt+S',
                click: () => {
                  this.saveCurrentHierarchyAs();
                },
              },
              {
                type: 'separator',
              },
            ]
          : []),
        {
          label: this.translate.instant('GLOBAL_MENU_RESTART_APP'),
          accelerator: 'CommandOrControl+R',
          click: () => {
            if (activeComponent === 'covisualization' && this.fileSystemService.currentFilePath) {
              this.configService.openSaveBeforeQuitDialog((e: string) => {
                if (e === 'confirm') {
                  const config = this.configService.getConfig();
                  if (config && config.constructDatasToSave) {
                    const datasToSave = config.constructDatasToSave();
                    this.fileSystemService.save(datasToSave);
                  }
                  this.storageService.saveAll(async () => {
                    await this.electronService.ipcRenderer?.invoke(
                      'app-relaunch',
                    );
                  });
                } else if (e === 'cancel') {
                  return;
                } else if (e === 'reject') {
                  this.storageService.saveAll(async () => {
                    await this.electronService.ipcRenderer?.invoke(
                      'app-relaunch',
                    );
                  });
                }
              }, { filename: this.fileSystemService.currentFilePath });
            } else {
              this.storageService.saveAll(async () => {
                await this.electronService.ipcRenderer?.invoke('app-relaunch');
              });
            }
          },
        },
        {
          label: this.translate.instant('GLOBAL_MENU_EXIT'),
          accelerator: 'CommandOrControl+Q',
          click: () => {
            if (activeComponent === 'covisualization' && this.fileSystemService.currentFilePath) {
              this.configService.openSaveBeforeQuitDialog((e: string) => {
                if (e === 'confirm') {
                  const config = this.configService.getConfig();
                  if (config && config.constructDatasToSave) {
                    const datasToSave = config.constructDatasToSave();
                    this.fileSystemService.save(datasToSave);
                  }
                  this.storageService.saveAll(async () => {
                    await this.electronService.ipcRenderer?.invoke('app-quit');
                  });
                } else if (e === 'cancel') {
                  return;
                } else if (e === 'reject') {
                  this.storageService.saveAll(async () => {
                    await this.electronService.ipcRenderer?.invoke('app-quit');
                  });
                }
              }, { filename: this.fileSystemService.currentFilePath });
            } else {
              this.storageService.saveAll(async () => {
                await this.electronService.ipcRenderer?.invoke('app-quit');
              });
            }
          },
        },
      ],
    };

    // insert history files after the first separator
    if (opendFiles.files.length > 0) {
      const insertIndex = menuFile.submenu.findIndex(
        (item: any) => item.type === 'separator',
      );
      // in reverse order
      for (let i = opendFiles.files.length - 1; i >= 0; i--) {
        if (typeof opendFiles.files[i] === 'string') {
          const filename = opendFiles.files[i];
          menuFile.submenu.splice(insertIndex + 1, 0, {
            label: filename,
            accelerator: '',
            enabled: true,
            click: ((_menuItem: any, browserWindow: any, event: any) => {
              if (event && event.shiftKey) {
                this.openFileInNewWindow(filename);
              } else {
                // Route through the main process with the explicit browserWindow.id
                // so the file always opens in the window the user clicked on,
                // regardless of which renderer's closure this handler runs in.
                this.electronService.ipcRenderer?.invoke(
                  'menu-action-open-recent-file',
                  filename,
                  browserWindow?.id,
                );
              }
            }) as any,
          });
        }
      }
    }

    const menuHelp = {
      label: this.translate.instant('GLOBAL_MENU_HELP'),
      submenu: [
        {
          role: 'toggleDevTools',
        },
        {
          type: 'separator',
        },
        {
          label:
            this.translate.instant('GLOBAL_MENU_VERSION') +
            ' ' +
            LibVersionService.getAppVersion(),
          click: () => {
            this.electronService.shell.openExternal(
              'https://github.com/KhiopsML/khiops-visualization-desktop/releases',
            );
          },
        },
        {
          label:
            this.translate.instant('GLOBAL_MENU_LIB_VERSION') +
            ' ' +
            LibVersionService.getLibVersion(),
          click: () => {
            this.electronService.shell.openExternal(
              'https://github.com/KhiopsML/khiops-visualization/releases',
            );
          },
        },
        {
          type: 'separator',
        },
        {
          label: this.translate.instant('GLOBAL_MENU_RELEASE_NOTES'),
          click: () => {
            this.electronService.shell.openExternal(
              'https://github.com/KhiopsML/khiops-visualization-desktop/releases',
            );
          },
        },
        {
          type: 'separator',
        },
        {
          label: this.translate.instant('GLOBAL_MENU_REPORT_A_BUG'),
          click: () => {
            const emailId = 'bug.khiopsvisualization@orange.com';
            const subject =
              LibVersionService.getAppTitle() +
              ': ' +
              this.translate.instant('GLOBAL_MENU_REPORT_A_BUG');
            const message =
              '\n\n--------------------------------------------------\n' +
              this.translate.instant('GLOBAL_MENU_VERSION') +
              ': ' +
              LibVersionService.getAppVersion() +
              '\n' +
              this.translate.instant('GLOBAL_MENU_LIB_VERSION') +
              ': ' +
              LibVersionService.getLibVersion() +
              '\n';

            this.electronService.shell.openExternal(
              'mailto:' +
                emailId +
                '?subject=' +
                subject +
                '&body=' +
                encodeURIComponent(message),
              '_self',
            );
          },
        },
      ],
    };

    const menuView = {
      label: this.translate.instant('GLOBAL_MENU_VIEW'),
      submenu: [
        {
          role: 'togglefullscreen',
        },
        {
          type: 'separator',
        },
        {
          role: 'resetZoom',
          accelerator: 'CommandOrControl+nummult',
        },
        {
          role: 'zoomIn',
          accelerator: 'CommandOrControl+numadd',
        },
        {
          role: 'zoomOut',
          accelerator: 'CommandOrControl+numsub',
        },
      ],
    };

    const menuTemplate = [];
    menuTemplate.push(menuFile);
    menuTemplate.push(menuView);
    menuTemplate.push(menuHelp);
    const menuUpdate = {
      label: btnUpdate
        ? btnUpdateText
        : this.translate.instant('GLOBAL_MENU_UPDATE'),
      submenu: [
        {
          label:
            btnUpdate === 'update-available'
              ? this.translate.instant('GLOBAL_UPDATE_CLICK_TO_UPDATE')
              : btnUpdate === 'update-ready'
                ? this.translate.instant('GLOBAL_INSTALL_AND_RESTART')
                : btnUpdateText,
          click: () => {
            if (btnUpdate === 'update-available' && !this.updateInProgress) {
              updateCb && updateCb();
            } else if (btnUpdate === 'update-ready') {
              installCb && installCb();
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: this.translate.instant('GLOBAL_MENU_CHANNELS'),
          submenu: [
            {
              label: this.translate.instant('GLOBAL_MENU_LATEST'),
              type: 'radio',
              click: () => {
                if (this.currentChannel !== 'latest') {
                  this.setChannel('latest', refreshCb);
                }
              },
              checked: this.currentChannel === 'latest',
            },
            {
              label: this.translate.instant('GLOBAL_MENU_BETA'),
              type: 'radio',
              click: () => {
                if (this.currentChannel !== 'beta') {
                  this.configService.openChannelDialog((e: string) => {
                    if (e === 'confirm') {
                      // User confirmed channel change
                      this.setChannel('beta', refreshCb);
                    } else if (e === 'cancel') {
                      this.setChannel('latest', refreshCb);
                      // reconstruct the menu to set channel to latest
                      refreshCb && refreshCb();
                    }
                  });
                }
              },
              checked: this.currentChannel === 'beta',
            },
          ],
        },
      ],
    };

    menuTemplate.push(menuUpdate);

    return menuTemplate;
  }

  openFileDialog(cb: any = undefined) {
    this.fileSystemService.openFileDialog(() => {
      this.menuShouldRebuild$.next();
      cb && cb();
    });
  }

  openFile(filename: string) {
    this.fileSystemService.openFile(filename, () => {
      this.menuShouldRebuild$.next();
    });
  }

  closeFile(callbackDone?: Function) {
    // Get the currently active tab
    const activeTab = this.tabManager.getActiveTab();
    const tabIdToClose = activeTab ? activeTab.id : undefined;
    this.fileSystemService.closeFile(() => {
      callbackDone && callbackDone();
    }, tabIdToClose);
  }

  setChannel(channel: string, refreshCb?: Function) {
    this.storageService.setOne('CHANNEL', channel);
    this.currentChannel = channel;

    (async () => {
      try {
        await this.electronService.ipcRenderer?.invoke(
          'launch-check-for-update',
          this.currentChannel,
          1000, // delay to let the menu update before launching the check for update
        );
        // Refresh menu after update check to reflect new state
        refreshCb && refreshCb();
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  openFileInNewWindow(filePath?: string) {
    // If a specific file is requested, check if it's already open in an existing tab
    if (filePath) {
      const existingTab = this.tabManager.getTabByFilePath(filePath);
      if (existingTab) {
        this.tabManager.setActiveTab(existingTab.id);
        return;
      }
    }

    this.electronService.ipcRenderer?.invoke('open-file-in-new-window', filePath);
  }

  save() {
    const config = this.configService.getConfig();
    if (config && config.constructDatasToSave) {
      const datasToSave = config.constructDatasToSave();
      this.fileSystemService.save(datasToSave);
    }
  }

  saveAs() {
    const config = this.configService.getConfig();
    if (config && config.constructDatasToSave) {
      const datasToSave = config.constructDatasToSave();
      this.fileSystemService.saveAs(datasToSave);
    }
  }

  saveCurrentHierarchyAs() {
    document.body.style.cursor = 'wait';
    setTimeout(() => {
      const config = this.configService.getConfig();
      if (config && config.constructPrunedDatasToSave) {
        const datasToSave = config.constructPrunedDatasToSave();
        this.fileSystemService.saveAs(datasToSave);
      }
      document.body.style.cursor = 'default';
    }, 1000);
  }
}
