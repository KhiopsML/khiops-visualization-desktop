/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Tab, TabService } from '../core/services/tab.service';
import { ConfigService } from '../core/services/config.service';
import { ElectronService } from '../core/services/electron.service';
import { TrackerService } from '../core/services/tracker.service';
import { StorageService } from '../core/services/storage.service';
import { MenuService } from '../core/services/menu.service';

declare const Tabs: any;

@Component({
  selector: 'app-tabs-container',
  templateUrl: './tabs-container.component.html',
  styleUrls: ['./tabs-container.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsContainerComponent implements AfterViewInit {
  @ViewChild('tabsElement', { static: false }) tabsElement?: ElementRef;

  tabs: Tab[] = [];
  activeTabId: string | null = null;
  activeComponent: 'visualization' | 'covisualization' = 'visualization';
  tabsInstance?: any;
  private visualizationConfigs: Map<string, any> = new Map();

  constructor(
    private tabService: TabService,
    private configService: ConfigService,
    private cdr: ChangeDetectorRef,
    public ngzone: NgZone,
    private electronService: ElectronService,
    private trackerService: TrackerService,
    private storageService: StorageService,
    private menuService: MenuService
  ) {}

  ngAfterViewInit() {
    // Subscribe to tabs
    this.tabService.getTabs().subscribe((tabs) => {
      this.tabs = tabs;
      // Update active component if the current active tab's type changed
      if (this.activeTabId) {
        const activeTab = tabs.find((t) => t.id === this.activeTabId);
        if (activeTab && activeTab.componentType !== this.activeComponent) {
          this.activeComponent = activeTab.componentType;
        }
      }
      this.cdr.detectChanges();
      this.reinitializeTabs();
    });

    // Subscribe to active tab
    this.tabService.getActiveTabId().subscribe((id) => {
      console.log('Active tab changed to:', id);
      this.activeTabId = id;
      this.updateActiveComponent();
      this.cdr.detectChanges();
      // Wait for view to update before setting up component
      setTimeout(() => {
        this.setupVisualizationComponent();
      }, 0);
    });

    // Initialize tabs container
    this.initializeTabs();

    // Setup component change callback
    this.configService.setComponentChangeCallback((componentType) => {
      // Update the component type for current tab
      if (this.activeTabId) {
        this.activeComponent = componentType;
        this.cdr.detectChanges();
      }
    });
  }

  private setupVisualizationComponent() {
    // Wait for the component to be rendered in the DOM
    console.log(
      'setupVisualizationComponent: starting, activeComponent:',
      this.activeComponent
    );
    setTimeout(async () => {
      // Request component change based on file type first
      const activeTab = this.tabService.getActiveTab();
      console.log(
        'setupVisualizationComponent: activeTab:',
        activeTab?.id,
        'componentType:',
        activeTab?.componentType
      );
      if (activeTab) {
        await this.configService.requestComponentChange(activeTab.filePath);
        // Force change detection after component type change
        this.cdr.detectChanges();
        // Wait for DOM to update with new component type
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const component = this.getActiveComponentElement();
      console.log(
        'setupVisualizationComponent: got component:',
        !!component,
        'activeComponent:',
        this.activeComponent
      );

      console.log('setupVisualizationComponent: initializing config');
      this.initializeComponentConfig(component);
      // Load tab data after a longer delay to ensure data is available
      // The file reading and data storage happens in FileSystemService
      setTimeout(() => {
        console.log('setupVisualizationComponent: loading tab data');
        this.loadTabData();
      }, 0);
    }, 0);
  }

  private getActiveComponentElement(): HTMLElement | undefined {
    const tabContent = document.querySelector('.tab-content');
    if (!tabContent) {
      console.log('getActiveComponentElement: tab-content not found');
      return undefined;
    }

    console.log(
      'getActiveComponentElement: searching for type:',
      this.activeComponent
    );
    if (this.activeComponent === 'visualization') {
      const result = tabContent.querySelector(
        'khiops-visualization'
      ) as HTMLElement | null;
      console.log(
        'getActiveComponentElement: found khiops-visualization:',
        !!result
      );
      return result || undefined;
    } else {
      const result = tabContent.querySelector(
        'khiops-covisualization'
      ) as HTMLElement | null;
      console.log(
        'getActiveComponentElement: found khiops-covisualization:',
        !!result
      );
      return result || undefined;
    }
  }

  private loadTabData(retryCount: number = 0) {
    const MAX_RETRIES = 10;
    if (!this.activeTabId) {
      console.log('loadTabData: No active tab ID');
      return;
    }

    const tabData = this.tabService.getTabData(this.activeTabId);

    console.log('loadTabData: tabId:', this.activeTabId, 'hasData:', !!tabData);

    if (!tabData) {
      // Data not yet available, retry with limit
      if (retryCount < MAX_RETRIES) {
        console.log(
          'loadTabData: Data not yet available, retrying... (attempt',
          retryCount + 1,
          'of',
          MAX_RETRIES + ')'
        );
        setTimeout(() => {
          this.loadTabData(retryCount + 1);
        }, 100);
      } else {
        console.error(
          'loadTabData: Max retries reached, data not available for tab:',
          this.activeTabId
        );
      }
      return;
    }

    // Get the current component element and call setDatas directly on it
    const component = this.getActiveComponentElement();
    if (component) {
      console.log('loadTabData: Setting data on component');
      //@ts-ignore
      component.setDatas(tabData);
    } else {
      console.log('loadTabData: Component not found!');
    }
  }

  private initializeComponentConfig(component: HTMLElement | undefined) {
    if (!component) {
      return;
    }

    //@ts-ignore
    if (!component.setConfig) {
      setTimeout(() => {
        this.initializeComponentConfig(component);
      }, 0);
      return;
    }

    //@ts-ignore
    component.setConfig({
      appSource: 'ELECTRON',
      storage: 'ELECTRON',
      onFileOpen: () => {
        console.log('fileOpen');
        this.menuService.openFileDialog(() => {
          // Callback after file open
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

    // Update the service config
    this.configService.setConfig(component);
    this.configService.setActiveComponentType(this.activeComponent);
  }

  private readLocalFile(input: File | any, cb: Function) {
    (async () => {
      try {
        if (this.electronService.isElectron) {
          let path: string = '';

          if (input?.path) {
            path = input?.path;
          } else {
            path = this.electronService.electron.webUtils.getPathForFile(input);
          }

          const content = await this.electronService.ipcRenderer?.invoke(
            'read-local-file',
            path
          );
          cb(content, path);
        }
      } catch (error) {
        console.log('error', error);
      }
    })();
  }

  private initializeTabs() {
    setTimeout(() => {
      const tabsEl = this.tabsElement?.nativeElement;
      if (tabsEl) {
        this.tabsInstance = new Tabs(tabsEl, {
          draggable: true,
          // Allow sorting tabs
          sortable: true,
        });

        // Listen for tab added/removed events
        tabsEl.addEventListener('addTab', (e: any) => {
          this.cdr.detectChanges();
        });

        tabsEl.addEventListener('removeTab', (e: any) => {
          this.cdr.detectChanges();
        });

        tabsEl.addEventListener('activeTabChange', (e: any) => {
          const tabId = e.detail?.tabEl?.getAttribute('data-tab-id');
          if (tabId) {
            this.ngzone.run(() => {
              this.tabService.switchToTab(tabId);
            });
          }
        });

        // Listen for tab reorder (drag & drop)
        tabsEl.addEventListener('tabMoveComplete', (e: any) => {
          this.onTabsReordered();
        });
      }
    }, 0);
  }

  private onTabsReordered() {
    // Get the new order from the DOM
    const tabsEl = this.tabsElement?.nativeElement;
    if (!tabsEl) {
      return;
    }

    const tabElements = tabsEl.querySelectorAll('[data-tab-id]');
    const newOrder: Tab[] = [];

    tabElements.forEach((el: HTMLElement) => {
      const tabId = el.getAttribute('data-tab-id');
      const tab = this.tabs.find((t) => t.id === tabId);
      if (tab) {
        newOrder.push(tab);
      }
    });

    // Update the service with the new order
    if (newOrder.length > 0) {
      this.tabService.reorderTabs(newOrder);
    }
  }

  private reinitializeTabs() {
    // Reinitialize the tabs component after DOM updates
    setTimeout(() => {
      const tabsEl = this.tabsElement?.nativeElement;
      if (tabsEl && this.tabsInstance) {
        // Update the tabs instance with the new tabs
        this.tabsInstance.update();
      }
    }, 0);
  }

  private updateActiveComponent() {
    const activeTab = this.tabService.getActiveTab();
    if (activeTab) {
      this.activeComponent = activeTab.componentType;
      this.cdr.detectChanges();
    }
  }

  getTabById(id: string): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  isTabActive(tabId: string): boolean {
    return this.activeTabId === tabId;
  }

  switchTab(tabId: string) {
    this.tabService.switchToTab(tabId);
  }

  closeTab(tabId: string) {
    this.visualizationConfigs.delete(tabId);
    this.tabService.closeTab(tabId);
  }

  trackByTabId(index: number, tab: Tab): string {
    return tab.id;
  }
}
