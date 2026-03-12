/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

/* eslint-disable no-console */
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  ViewChild,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { ElectronService } from './core/services/electron.service';
import { ConfigService } from './core/services/config.service';
import { MenuService } from './core/services/menu.service';
import { FileSystemService } from './core/services/file-system.service';
import { TrackerService } from './core/services/tracker.service';
import 'khiops-visualization';
import { StorageService } from './core/services/storage.service';
import { WelcomeComponent } from './welcome/welcome.component';
import { BigFileLoadingComponent } from './big-file-loading/big-file-loading.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [CommonModule, WelcomeComponent, BigFileLoadingComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AppComponent implements AfterViewInit {
  @ViewChild('visualizationComponent', {
    static: false,
  })
  visualizationComponent?: ElementRef<HTMLElement>;
  @ViewChild('covisualizationComponent', {
    static: false,
  })
  covisualizationComponent?: ElementRef<HTMLElement>;

  config: any;
  activeComponent: 'visualization' | 'covisualization' = 'visualization';
  currentFileType?: string;
  isDragOver: boolean = false;
  private dragCounter: number = 0;
  btnUpdateText: string = '';
  btnUpdate?: string;
  updateState: 'idle' | 'available' | 'downloading' | 'ready' = 'idle';
  updateAvailableTimer?: any;
  isUpdateInstalled = false;

  constructor(
    public ngzone: NgZone,
    private cdr: ChangeDetectorRef,
    private electronService: ElectronService,
    private fileSystemService: FileSystemService,
    private storageService: StorageService,
    private configService: ConfigService,
    private translate: TranslateService,
    private menuService: MenuService,
    private trackerService: TrackerService,
  ) {
    this.translate.setFallbackLang('en');

    this.trackerService.initialize();
  }

  ngAfterViewInit() {
    this.btnUpdateText =
      '✅ ' + this.translate.instant('GLOBAL_UPDATE_UP_TO_DATE');

    this.configService.setComponentChangeCallback((componentType) => {
      this.setActiveComponent(componentType);
    });

    this.setAppConfig();
    if (this.electronService.isElectron) {
      this.addIpcRendererEvents();
    }
  }

  setAppConfig() {
    // Initialiser avec le composant visualization par défaut
    this.setActiveComponent('visualization');
  }

  setActiveComponent(componentType: 'visualization' | 'covisualization') {
    this.activeComponent = componentType;
    // Update synchronously so that fileSystemService.readFile can use the correct type
    // immediately without waiting for the 50ms timeout in continueSetActiveComponent
    this.configService.setActiveComponentType(componentType);
    this.cdr.detectChanges();

    setTimeout(() => {
      if (componentType === 'visualization') {
        this.config = this.visualizationComponent?.nativeElement;
      } else {
        this.config = this.covisualizationComponent?.nativeElement;
      }

      if (!this.config) {
        setTimeout(() => {
          this.continueSetActiveComponent(componentType);
        }, 100);
        return;
      }

      this.continueSetActiveComponent(componentType);
    }, 50);
  }

  continueSetActiveComponent(
    componentType: 'visualization' | 'covisualization',
  ) {
    if (componentType === 'visualization') {
      this.config = this.visualizationComponent?.nativeElement;
    } else {
      this.config = this.covisualizationComponent?.nativeElement;
    }

    if (!this.config) {
      return;
    }

    this.config.setConfig({
      appSource: 'ELECTRON',
      storage: 'ELECTRON',
      lsId: this.storageService.getStorageKey(),
      onFileOpen: () => {
        console.log('fileOpen');
        this.menuService.openFileDialog(() => {
          this.constructMenu();
        });
      },
      onCopyImage: (base64data: any) => {
        const natImage =
          this.electronService.nativeImage.createFromDataURL(base64data);
        this.electronService.clipboard.writeImage(natImage);
      },
      readLocalFile: (file: File | any, cb: Function) => {
        return this.readLocalFile(file, cb);
      },
      onSendEvent: (event: { message: string; data: any }, cb?: Function) => {
        if (event.message === 'forgetConsentGiven') {
          this.trackerService.forgetConsentGiven();
        } else if (event.message === 'setConsentGiven') {
          this.trackerService.setConsentGiven();
        } else if (event.message === 'trackEvent') {
          this.trackerService.trackEvent(event.data);
        } else if (event.message === 'ls.getAll') {
          cb && cb(this.storageService.getAll());
        } else if (event.message === 'ls.saveAll') {
          this.storageService.saveAll();
        } else if (event.message === 'ls.delAll') {
          this.storageService.delAll();
        }
      },
    });

    // Mettre à jour le service de configuration
    this.configService.setConfig(this.config);
    this.configService.setActiveComponentType(componentType);
  }

  determineComponentFromFile(
    filePath: string,
  ): 'visualization' | 'covisualization' {
    if (!filePath) {
      return 'visualization';
    }

    const extension = filePath.toLowerCase().split('.').pop();

    switch (extension) {
      case 'khj':
        return 'visualization';
      case 'khcj':
        return 'covisualization';
      case 'json':
        return 'visualization';
      default:
        return 'visualization';
    }
  }

  readLocalFile(input: File | any, cb: Function) {
    (async () => {
      try {
        if (this.electronService.isElectron) {
          let path: string = '';

          if (input?.path) {
            // If command is called by saved json datas
            path = input?.path;
          } else {
            // If command is called by user
            path = this.electronService.electron.webUtils.getPathForFile(input);
          }

          this.currentFileType = path;

          const content = await this.electronService.ipcRenderer?.invoke(
            'read-local-file',
            path,
          );
          cb(content, path);
        }
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  addIpcRendererEvents() {
    this.electronService.ipcRenderer?.on('update-available', (event, arg) => {
      console.info('update-available', event, arg);
      this.updateState = 'available';
      this.btnUpdate = 'update-available';
      this.btnUpdateText =
        '🔁 ' + this.translate.instant('GLOBAL_UPDATE_UPDATE_AVAILABLE');
      this.constructMenu();

      // Auto-download will be triggered by main.ts after 5 seconds
      // Show the "Update available" menu for 5 seconds, then UI will update when download starts
    });
    this.electronService.ipcRenderer?.on(
      'update-not-available',
      (event, arg) => {
        console.info('update-not-available', event, arg);
        this.menuService.setUpdateInProgress(false);
      },
    );
    this.electronService.ipcRenderer?.on('update-error', (event, arg) => {
      console.info('update-error', event, arg);
      this.menuService.setUpdateInProgress(false);
      // this.btnUpdate = 'update-error';
      // this.btnUpdateText = '⚠ ' + this.translate.instant('GLOBAL_UPDATE_UPDATE_ERROR');
      this.constructMenu();
    });
    this.electronService.ipcRenderer?.on(
      'download-progress-info',
      (event, arg) => {
        console.info('download-progress-info', arg && arg.percent);
        // Download progress update
        this.updateState = 'downloading';
        this.btnUpdate = 'downloading';
        this.btnUpdateText =
          '🔁 ' +
          this.translate.instant('GLOBAL_UPDATE_DOWNLOADING') +
          ' ' +
          parseInt(arg && arg.percent, 10) +
          '%';
        this.constructMenu();
      },
    );
    this.electronService.ipcRenderer?.on('update-ready', (event, arg) => {
      console.info('update-ready', event, arg);
      this.updateState = 'ready';
      this.btnUpdate = 'update-ready';
      this.btnUpdateText = '✅ Update ready';
      this.constructMenu();
    });
    this.electronService.ipcRenderer?.on('before-quit', () => {
      this.beforeQuit();
    });
    this.electronService.ipcRenderer?.on('copy-image', () => {
      this.configService.copyImage();
    });
    this.electronService.ipcRenderer?.on('right-click', (_event, arg) => {
      this.configService.rightClick(arg);
    });
    this.electronService.ipcRenderer?.on('copy-datas', () => {
      this.configService.copyDatas();
    });

    this.constructMenu();

    // Get input file on windows
    const inputFile =
      this.electronService.ipcRenderer?.sendSync('get-input-file');
    if (inputFile && inputFile !== '.') {
      setTimeout(() => {
        this.currentFileType = inputFile;
        this.fileSystemService.openFile(inputFile, () => {
          this.constructMenu();
        });
      });
    }
    this.electronService.ipcRenderer?.on('file-open-system', (event, arg) => {
      if (arg) {
        // Add delay to ensure component is fully loaded before opening file
        setTimeout(() => {
          this.currentFileType = arg;
          this.fileSystemService.openFile(arg, () => {
            this.constructMenu();
          });
        }, 750); // 500ms delay to ensure component initialization
      }
    });
  }

  /**
   * Handles drag enter event for file drop
   */
  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDragOver = true;
    }
  }

  /**
   * Handles drag over event for file drop
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Handles drag leave event for file drop
   */
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragOver = false;
    }
  }

  /**
   * Handles file drop event
   */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragOver = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0 && files[0]) {
      this.processDroppedFile(files[0]);
    }
  }

  /**
   * Processes the dropped file if it has a valid extension.
   * Web components (BaseDragDropComponent) are disabled in Electron mode,
   * so all DnD drops are handled exclusively here.
   */
  private processDroppedFile(file: File): void {
    const validExtensions = ['.json', '.khj', '.khcj'];
    const fileExtension = file.name
      .toLowerCase()
      .substring(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(fileExtension)) {
      console.warn(
        `Invalid file extension: ${fileExtension}. Supported extensions: ${validExtensions.join(', ')}`,
      );
      return;
    }

    if (!this.electronService.isElectron) {
      return;
    }

    // The file was dropped on a non-web-component area (welcome screen, etc.).
    // Handle it directly through fileSystemService.openFile which manages
    // component switching, welcome screen, and data loading.
    const path = this.electronService.electron.webUtils.getPathForFile(file);
    if (!path) {
      return;
    }

    this.currentFileType = path;
    this.fileSystemService.openFile(path, () => {
      this.constructMenu();
    });
  }

  beforeQuit() {
    // If update is ready but not installed, mark for auto-install on quit
    if (this.updateState === 'ready' && !this.isUpdateInstalled) {
      (async () => {
        await this.electronService.ipcRenderer?.invoke(
          'set-update-auto-install-on-quit',
        );
        this.fileSystemService.handleSaveBeforeAction(async () => {
          await this.electronService.ipcRenderer?.invoke('app-quit');
        });
      })();
    } else {
      this.fileSystemService.handleSaveBeforeAction(async () => {
        await this.electronService.ipcRenderer?.invoke('app-quit');
      });
    }
  }

  constructMenu() {
    const menuTemplate = this.menuService.setMenu(
      this.btnUpdate,
      this.btnUpdateText,
      () => {
        this.constructMenu();
      },
      () => {
        (async () => {
          this.menuService.setUpdateInProgress(true);

          this.btnUpdateText =
            '🔁 ' +
            this.translate.instant('GLOBAL_UPDATE_WAITING_FOR_DOWNLOAD') +
            ' ...';
          await this.electronService.ipcRenderer?.invoke(
            'launch-update-available',
          );
          this.constructMenu();
        })();
      },
      () => {
        // Install update when user clicks on "Install and restart"
        (async () => {
          console.info('Installing update now');
          this.isUpdateInstalled = true;
          await this.electronService.ipcRenderer?.invoke('install-update-now');
        })();
      },
      this.activeComponent,
    );
    const menu =
      this.electronService.remote.Menu.buildFromTemplate(menuTemplate);
    this.electronService.remote.Menu.setApplicationMenu(menu);
  }
}
