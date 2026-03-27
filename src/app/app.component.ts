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
  CUSTOM_ELEMENTS_SCHEMA,
  QueryList,
  ViewChildren,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { ElectronService } from './core/services/electron.service';
import { ConfigService } from './core/services/config.service';
import { MenuService } from './core/services/menu.service';
import { FileSystemService } from './core/services/file-system.service';
import { TrackerService } from './core/services/tracker.service';
import { TabManagerService } from './core/services/tab-manager.service';
import 'khiops-visualization';
import { StorageService } from './core/services/storage.service';
import { WelcomeComponent } from './welcome/welcome.component';
import { BigFileLoadingComponent } from './big-file-loading/big-file-loading.component';
import { TabHeaderComponent } from './tab-header/tab-header.component';
import { Tab } from './core/interfaces/tab.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    WelcomeComponent,
    BigFileLoadingComponent,
    TabHeaderComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('khiopsComponent')
  khiopsComponents!: QueryList<ElementRef<HTMLElement>>;

  config: any;
  tabs: Tab[] = [];
  activeTab: Tab | null = null;
  isDragOver: boolean = false;
  private destroy$ = new Subject<void>();
  private dragCounter: number = 0;
  btnUpdateText: string = '';
  btnUpdate?: string;
  updateState: 'idle' | 'available' | 'downloading' | 'ready' = 'idle';
  updateAvailableTimer?: any;
  isUpdateInstalled = false;

  // Map to store each tab's component configuration and instance data
  private tabConfigs = new Map<string, any>();
  private tabInstances = new Map<string, string>(); // Map tab ID to instance ID

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
    private tabManager: TabManagerService,
  ) {
    this.translate.setFallbackLang('en');

    this.trackerService.initialize();
  }

  ngAfterViewInit() {
    this.btnUpdateText =
      '✅ ' + this.translate.instant('GLOBAL_UPDATE_UP_TO_DATE');

    // Subscribe to tab changes
    this.tabManager.tabState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        const previousActiveTab = this.activeTab;
        this.tabs = state.tabs;
        this.activeTab = state.tabs.find((tab) => tab.isActive) || null;

        // Check if active tab has changed
        const activeTabChanged = previousActiveTab?.id !== this.activeTab?.id;

        this.cdr.detectChanges();

        // Configure all tab components
        setTimeout(() => {
          this.configureAllTabComponents();

          // If active tab changed, switch active config immediately
          if (activeTabChanged && this.activeTab) {
            this.setActiveConfig(this.activeTab);
            // Propagate resize event when tab changes
            this.propagateResizeEvent();
          }
        }, 100);
      });

    this.configService.setComponentChangeCallback((componentType, filePath) => {
      this.handleComponentChange(componentType, filePath);
    });

    // Set up tab-specific data callback
    this.configService.setTabDataCallback((tabId, data) => {
      this.setDataForTab(tabId, data);
    });

    this.setAppConfig();

    // Subscribe to menu rebuild signal (e.g., when file is opened from recently opened files)
    this.menuService.menuShouldRebuild$.subscribe(() => {
      this.constructMenu();
    });

    if (this.electronService.isElectron) {
      this.addIpcRendererEvents();
    }
  }

  setAppConfig() {
    // Initialize with empty tab - TabManagerService already creates one
  }

  handleComponentChange(
    componentType: 'visualization' | 'covisualization',
    filePath?: string,
  ) {
    const activeTab = this.tabManager.getActiveTab();
    if (activeTab && filePath) {
      // Create a new tab for this file
      const tabId = this.tabManager.openFileInTab(filePath, componentType);
      const tab = this.tabManager.getTab(tabId)!;

      // Configure component and set as active
      this.configureTabComponent(tab);
      this.setActiveConfig(tab);
    } else if (activeTab) {
      // Just change component type for active tab
      this.tabManager.updateTab(activeTab.id, { componentType });
      this.configureTabComponent(activeTab);
      this.setActiveConfig(activeTab);
    }
  }

  /**
   * Configure all tab components
   */
  private configureAllTabComponents() {
    this.tabs.forEach((tab) => {
      if (!this.tabConfigs.has(tab.id)) {
        this.configureTabComponent(tab);
      }
    });

    // Set active tab config
    if (this.activeTab) {
      this.setActiveConfig(this.activeTab);
    }
  }

  /**
   * Set the active configuration for the config service
   */
  private setActiveConfig(tab: Tab) {
    const tabConfig = this.tabConfigs.get(tab.id) as any; // Cast to any for khiops methods
    if (tabConfig) {
      this.config = tabConfig;
      this.configService.setActiveComponentType(tab.componentType);
      this.configService.setConfig(this.config);
    }
  }

  /**
   * Send data directly to a specific tab's component
   */
  setDataForTab(tabId: string, data: any) {
    const tabConfig = this.tabConfigs.get(tabId) as any; // Cast to any for khiops methods
    if (
      tabConfig &&
      tabConfig.setDatas &&
      typeof tabConfig.setDatas === 'function'
    ) {
      tabConfig.setDatas(data);
    } else {
      // Fallback to global setDatas
      if (this.config && this.config.setDatas) {
        this.config.setDatas(data);
      }
    }
  }

  private configureTabComponent(tab: Tab, retryCount = 0) {
    const maxRetries = 10;
    const componentElement = this.getComponentElementForTab(tab);

    if (!componentElement && retryCount < maxRetries) {
      // Component not ready yet, retry
      setTimeout(() => {
        this.configureTabComponent(tab, retryCount + 1);
      }, 100);
      return;
    }

    if (!componentElement) {
      console.warn('Could not find component element for tab:', tab);
      return;
    }

    // Store this tab's configuration
    const tabConfig = componentElement as any;
    this.tabConfigs.set(tab.id, tabConfig);

    // Configure component with unique instance configuration compatible with Shadow DOM
    if (tabConfig.setConfig && typeof tabConfig.setConfig === 'function') {
      // Generate timestamp-based instance ID like visualization-component expects
      const timestamp = Date.now();
      const random = Math.random().toString(36).substr(2, 9);
      const compatibleInstanceId = `${timestamp}_${random}_tab_${tab.id}`;

      tabConfig.setConfig({
        appSource: 'ELECTRON',
        storage: 'ELECTRON',
        // Compatible instanceId format for Shadow DOM isolation
        instanceId: compatibleInstanceId,
        lsId: `${this.storageService.getStorageKey()}_${compatibleInstanceId}`,
        onFileOpen: () => {
          console.log('fileOpen from tab:', tab.id);
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
          return this.readLocalFile(file, cb, tab);
        },
        onSendEvent: (event: { message: string; data: any }, cb?: Function) => {
          if (event.message === 'forgetConsentGiven') {
            this.trackerService.forgetConsentGiven();
          } else if (event.message === 'setConsentGiven') {
            this.trackerService.setConsentGiven();
          } else if (event.message === 'trackEvent') {
            this.trackerService.trackEvent(event.data);
          } else if (event.message === 'ls.getAll') {
            // Return isolated storage for this specific tab instance
            cb && cb(this.storageService.getTabStorage(compatibleInstanceId));
          } else if (event.message === 'ls.saveAll') {
            this.storageService.saveTabStorage(compatibleInstanceId);
          } else if (event.message === 'ls.delAll') {
            this.storageService.delTabStorage(compatibleInstanceId);
          }
        },
      });

      // Store the compatible instance ID
      this.tabInstances.set(tab.id, compatibleInstanceId);
    } else {
      console.warn(
        'setConfig method not available on component for tab:',
        tab.id,
      );
    }

    // Update global config only for active tab
    if (tab.isActive) {
      this.config = componentElement;
      this.configService.setActiveComponentType(tab.componentType);
      this.configService.setConfig(this.config);
    }
  }

  /**
   * Get the active component element from the DOM
   */
  private getActiveComponentElement(): HTMLElement | undefined {
    if (!this.activeTab) {
      return undefined;
    }

    const element = this.getComponentElementForTab(this.activeTab);
    return element || undefined;
  }

  /**
   * Propagate resize event to the active visualization component
   */
  private propagateResizeEvent(): void {
    const component = this.getActiveComponentElement();
    if (!component) {
      return;
    }

    try {
      // Try calling onResize method if available
      if (typeof (component as any).onResize === 'function') {
        (component as any).onResize();
      }

      // Dispatch a native resize event
      const resizeEvent = new Event('resize', {
        bubbles: true,
        cancelable: true,
      });
      component.dispatchEvent(resizeEvent);

      // Dispatch a window resize event
      window.dispatchEvent(new Event('resize'));
    } catch (error) {
      console.error('Error propagating resize event:', error);
    }
  }

  private getComponentElementForTab(tab: Tab): HTMLElement | null {
    if (!this.khiopsComponents) return null;

    // Find component by data-tab-id attribute
    const components = this.khiopsComponents.toArray();
    for (const component of components) {
      const element = component.nativeElement;
      if (element.getAttribute('data-tab-id') === tab.id) {
        return element;
      }
    }

    return null;
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

  readLocalFile(input: File | any, cb: Function, tab?: Tab) {
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

          console.log('🚀 ~ AppComponent ~ readLocalFile ~ path:', path);
          if (path === 'END_TO_END_PATH') {
            path =
              process.env.GITHUB_WORKSPACE +
              'e2e/mocks/ExternalDataEducation.txt';
          }

          const content = await this.electronService.ipcRenderer?.invoke(
            'read-local-file',
            path,
          );

          // Pass tab info to callback if available
          if (tab) {
            cb(content, path, tab);
          } else {
            cb(content, path);
          }
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
        this.fileSystemService.openFile(inputFile);
      });
    }
    this.electronService.ipcRenderer?.on('file-open-system', (event, arg) => {
      if (arg) {
        // Add delay to ensure component is fully loaded before opening file
        // setTimeout(() => {
        this.fileSystemService.openFile(arg);
        // }, 100);
      }
    });

    // Listen for detached tab restoration from new window
    this.electronService.ipcRenderer?.on('restore-tab', (event, data) => {
      if (data && data.tab) {
        const tab = data.tab;
        // Add delay to ensure component is fully loaded before restoring tab
        // setTimeout(() => {
        if (tab.filePath) {
          // If the tab has a file path, open the file which will load the data
          this.fileSystemService.openFile(tab.filePath);
        } else {
          // If no file path, just restore the tab with existing data
          this.tabManager.restoreTab(tab);
        }
        // }, 100);
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
   * Opens file in the active tab or creates a new tab if needed.
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

    const path = this.electronService.electron.webUtils.getPathForFile(file);
    if (!path) {
      return;
    }

    // Open the file - openFile will create the tab
    this.fileSystemService.openFile(path);
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
    const activeComponentType =
      this.activeTab?.componentType || 'visualization';

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
      activeComponentType,
    );
    const menu =
      this.electronService.remote.Menu.buildFromTemplate(menuTemplate);
    this.electronService.remote.Menu.setApplicationMenu(menu);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Track by function for tab performance
   */
  trackByTabId(index: number, tab: Tab): string {
    return tab.id;
  }
}
