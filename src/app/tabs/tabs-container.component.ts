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
  private initializedTabs: Set<string> = new Set();

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
      this.activeTabId = id;
      this.updateActiveComponent();
      this.cdr.detectChanges();
      // Only setup component if not already initialized
      if (id && !this.initializedTabs.has(id)) {
        setTimeout(() => {
          this.setupVisualizationComponent();
        }, 0);
      }
      // Propagate resize event when tab changes
      this.propagateResizeEvent();
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

  private propagateResizeEvent() {
    const component = this.getActiveComponentElement();
    if (!component) {
      return;
    }

    // Dispatch a resize event to the component
    try {
      // Try calling a method on the component if available
      if (typeof (component as any).onResize === 'function') {
        (component as any).onResize();
      }

      // Also dispatch a native resize event
      const resizeEvent = new Event('resize', {
        bubbles: true,
        cancelable: true,
      });
      component.dispatchEvent(resizeEvent);

      // Dispatch a window resize event inside the component's shadow DOM
      window.dispatchEvent(new Event('resize'));
    } catch (error) {
      console.error('Error propagating resize event:', error);
    }
  }

  private setupVisualizationComponent() {
    // Component type should already be resolved at this point

    setTimeout(() => {
      const component = this.getActiveComponentElement();

      this.initializeComponentConfig(component);
      // Load tab data after a longer delay to ensure data is available
      // The file reading and data storage happens in FileSystemService
      this.loadTabData();
      // Mark this tab as initialized
      if (this.activeTabId) {
        this.initializedTabs.add(this.activeTabId);
      }
    }, 100);
  }

  private getActiveComponentElement(): HTMLElement | undefined {
    const tabContent = document.querySelector('.tab-content');
    if (!tabContent) {
      return undefined;
    }

    if (this.activeComponent === 'visualization') {
      const result = tabContent.querySelector(
        `khiops-visualization[data-tab-id="${this.activeTabId}"]`
      ) as HTMLElement | null;

      return result || undefined;
    } else {
      const result = tabContent.querySelector(
        `khiops-covisualization[data-tab-id="${this.activeTabId}"]`
      ) as HTMLElement | null;

      return result || undefined;
    }
  }

  private loadTabData(retryCount: number = 0) {
    if (!this.activeTabId) {
      return;
    }
    const tabData = this.tabService.getTabData(this.activeTabId);
    // Get the current component element and call setDatas directly on it
    const component = this.getActiveComponentElement();
    if (component) {
      //@ts-ignore
      component.setDatas(tabData);
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
    this.initializedTabs.delete(tabId);
    this.tabService.closeTab(tabId);
  }

  trackByTabId(index: number, tab: Tab): string {
    return tab.id;
  }

  getTabIcon(componentType: 'visualization' | 'covisualization'): string {
    if (componentType === 'covisualization') {
      return 'assets/icons/icon-covisu.png';
    }
    return 'assets/icons/icon-visu.png';
  }

  openFileDialog() {
    this.menuService.openFileDialog(() => {
      // Callback after file open
    });
  }
}
