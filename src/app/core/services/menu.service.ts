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
  ) {
    this.currentChannel = this.storageService.getOne('CHANNEL') || 'latest';

    (async () => {
      try {
        await this.electronService.ipcRenderer?.invoke(
          'launch-check-for-update',
          this.currentChannel,
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
          click: () => {
            this.openFileDialog(refreshCb);
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
            if (activeComponent === 'covisualization') {
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
              });
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
            if (activeComponent === 'covisualization') {
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
              });
            } else {
              this.storageService.saveAll(async () => {
                await this.electronService.ipcRenderer?.invoke('app-quit');
              });
            }
          },
        },
      ],
    };

    menuFile.submenu[3].accelerator = 'CommandOrControl+W';

    // insert history files
    if (opendFiles.files.length > 0) {
      // in reverse order
      for (let i = opendFiles.files.length - 1; i >= 0; i--) {
        if (typeof opendFiles.files[i] === 'string') {
          const filename = opendFiles.files[i];
          menuFile.submenu.splice(2, 0, {
            label: filename,
            enabled: true,
            click: () => {
              this.openFile(filename);
            },
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
      // Wait for storage to be saved before rebuilding menu to ensure history is persisted
      this.storageService.saveAll(() => {
        // Small delay to ensure activeComponent is updated before rebuilding menu
        setTimeout(() => {
          // Notify that menu should be rebuilt after file opens
          this.menuShouldRebuild$.next();
          cb && cb();
        }, 100);
      });
    });
  }

  openFile(filename: string) {
    this.fileSystemService.openFile(filename, () => {
      // Wait for storage to be saved before rebuilding menu to ensure history is persisted
      this.storageService.saveAll(() => {
        // Small delay to ensure activeComponent is updated before rebuilding menu
        setTimeout(() => {
          // Notify that menu should be rebuilt after file opens
          this.menuShouldRebuild$.next();
        }, 100);
      });
    });
  }

  closeFile(callbackDone?: Function) {
    this.fileSystemService.closeFile(() => {
      callbackDone && callbackDone();
    });
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
