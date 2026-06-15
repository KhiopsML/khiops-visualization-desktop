/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { TabManagerService } from '../core/services/tab-manager.service';
import { MenuService } from '../core/services/menu.service';
import { FileSystemService } from '../core/services/file-system.service';
import { ElectronService } from '../core/services/electron.service';
import { TabDragService } from '../core/services/tab-drag.service';
import { ConfigService } from '../core/services/config.service';
import { Tab } from '../core/interfaces/tab.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-tab-header',
  templateUrl: './tab-header.component.html',
  styleUrls: ['./tab-header.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class TabHeaderComponent implements OnInit, OnDestroy {
  tabs: Tab[] = [];
  activeTabId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private tabManager: TabManagerService,
    private menuService: MenuService,
    private fileSystemService: FileSystemService,
    private electronService: ElectronService,
    private tabDrag: TabDragService,
    private configService: ConfigService,
    private translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.tabManager.tabState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.tabs = state.tabs;
        this.activeTabId = state.activeTabId;
      });

    // Listen for keyboard shortcuts relayed from the main process via before-input-event
    const ipc = this.electronService.ipcRenderer;
    if (ipc) {
      ipc.on('shortcut-close-tab', () => {
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab) this.closeTabWithCleanup(activeTab);
      });
      ipc.on('shortcut-close-all-tabs', () => {
        if (this.tabs.length > 1) this.closeAllTabs();
      });
      ipc.on('shortcut-move-tab-new-window', () => {
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab?.filePath) this.moveTabToNewWindow(activeTab);
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    const ipc = this.electronService.ipcRenderer;
    if (ipc) {
      ipc.removeAllListeners('shortcut-close-tab');
      ipc.removeAllListeners('shortcut-close-all-tabs');
      ipc.removeAllListeners('shortcut-move-tab-new-window');
    }
  }

  /**
   * Handle tab pointer down to start drag
   */
  onTabPointerDown(event: PointerEvent, tab: Tab, tabEl: HTMLElement): void {
    this.tabDrag.startDrag(event, tab.id, tabEl);
  }

  /**
   * Handle right-click on tab to show context menu
   */
  onTabContextMenu(event: MouseEvent, tab: Tab): void {
    event.preventDefault();
    event.stopPropagation();

    const remote = this.electronService.remote;
    if (!remote) return;

    const { Menu, MenuItem } = remote;
    const menu = new Menu();

    menu.append(
      new MenuItem({
        label: this.translate.instant('TAB_CONTEXT_CLOSE'),
        accelerator: 'CommandOrControl+W',
        click: () => this.closeTabWithCleanup(tab),
      }),
    );

    menu.append(
      new MenuItem({
        label: this.translate.instant('TAB_CONTEXT_MOVE_NEW_WINDOW'),
        accelerator: 'CommandOrControl+Shift+N',
        enabled: !!tab.filePath,
        click: () => this.moveTabToNewWindow(tab),
      }),
    );

    if (this.tabs.length > 1) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: this.translate.instant('TAB_CONTEXT_CLOSE_ALL'),
          accelerator: 'CommandOrControl+Shift+W',
          click: () => this.closeAllTabs(),
        }),
      );
    }

    menu.popup();
  }

  /**
   * Close all open tabs sequentially.
   * For covisualization tabs with unsaved changes, shows a save dialog.
   * When multiple covisualization tabs require a decision, "Yes to All" and
   * "No to All" buttons are displayed so the user can apply one choice to all
   * remaining tabs (mirroring Notepad++ behaviour).
   */
  private closeAllTabs(): void {
    // Process the active tab first, then the others in their existing order
    const activeTab = this.tabManager.getActiveTab();
    const rest = this.tabs.filter((t) => t.id !== activeTab?.id);
    const tabsCopy = activeTab ? [activeTab, ...rest] : [...this.tabs];
    let saveAll = false;
    let rejectAll = false;

    const countRemainingCovisu = (fromIndex: number): number =>
      tabsCopy
        .slice(fromIndex)
        .filter(
          (t) =>
            t.componentType === 'covisualization' &&
            t.filePath &&
            this.tabManager.getTab(t.id),
        ).length;

    const closeNext = (index: number) => {
      if (index >= tabsCopy.length) return;
      const tab = tabsCopy[index];
      // Skip tabs that were already closed
      if (!this.tabManager.getTab(tab.id)) {
        closeNext(index + 1);
        return;
      }

      if (tab.componentType === 'covisualization' && tab.filePath) {
        this.tabManager.setActiveTab(tab.id);
        this.fileSystemService.currentFilePath = tab.filePath;
        this.fileSystemService['configService'].setActiveComponentType(
          'covisualization',
        );

        if (saveAll) {
          // "Yes to All" was chosen: auto-save without showing the dialog
          setTimeout(() => {
            this.fileSystemService.closeFile(
              () => closeNext(index + 1),
              tab.id,
              { showBatchButtons: false, autoSave: true },
            );
          }, 150);
        } else if (rejectAll) {
          // "No to All" was chosen: auto-close without saving
          setTimeout(() => {
            this.fileSystemService.closeFile(
              () => closeNext(index + 1),
              tab.id,
              { showBatchButtons: false, autoClose: true },
            );
          }, 150);
        } else {
          // Show the dialog; add batch buttons when more covisu tabs remain
          const showBatchButtons = countRemainingCovisu(index + 1) > 0;
          setTimeout(() => {
            this.fileSystemService.closeFile(
              () => closeNext(index + 1),
              tab.id,
              showBatchButtons
                ? {
                    showBatchButtons: true,
                    onConfirmAll: () => {
                      saveAll = true;
                    },
                    onRejectAll: () => {
                      rejectAll = true;
                    },
                  }
                : undefined,
            );
          }, 150);
        }
      } else {
        this.tabManager.closeTab(tab.id);
        if (!this.tabManager.hasOpenTabs()) {
          this.fileSystemService.closeFile();
        }
        closeNext(index + 1);
      }
    };
    closeNext(0);
  }

  /**
   * Move a tab into a new Electron window
   */
  private moveTabToNewWindow(tab: Tab): void {
    if (!tab || !this.electronService.ipcRenderer) return;

    // Capture the current component state before moving
    let currentDatas: any = undefined;
    const config = this.configService.getConfig() as any;
    if (config && typeof config.constructDatasToSave === 'function') {
      try {
        currentDatas = config.constructDatasToSave();
      } catch (e) {
        console.warn('Could not capture tab state before move:', e);
      }
    } else if (config && typeof config.getDatas === 'function') {
      try {
        currentDatas = config.getDatas();
      } catch (e) {
        console.warn('Could not capture tab state before move:', e);
      }
    }

    const tabToTransfer = { ...tab, datas: currentDatas };

    this.electronService.ipcRenderer
      .invoke('create-window-with-tab', { tab: tabToTransfer })
      .then(() => {
        this.tabManager.closeTab(tab.id);
        // If no tabs remain, show the welcome screen
        if (!this.tabManager.hasOpenTabs()) {
          this.fileSystemService.closeFile();
        }
      })
      .catch((error: any) => {
        console.error('Error moving tab to new window:', error);
      });
  }

  /**
   * Handle tab click to activate
   */
  onTabClick(tab: Tab): void {
    this.tabManager.setActiveTab(tab.id);
  }

  /**
   * Handle middle click on tab to close it
   */
  onTabMouseUp(event: MouseEvent, tab: Tab): void {
    if (event.button === 1) {
      event.preventDefault();
      this.closeTabWithCleanup(tab);
    }
  }

  /**
   * Handle tab close button click
   */
  onTabClose(event: Event, tab: Tab): void {
    event.stopPropagation();
    this.closeTabWithCleanup(tab);
  }

  /**
   * Close tab and clean up file system state if needed
   */
  private closeTabWithCleanup(tab: Tab): void {
    // For covisualization files, show save dialog before closing
    if (tab.componentType === 'covisualization' && tab.filePath) {
      // Save the currently active tab so we can restore it after closing
      const previousActiveTab = this.tabManager.getActiveTab();

      // Set the tab to close as active so we can access its save dialog
      this.tabManager.setActiveTab(tab.id);
      // Store the currentFilePath and component type so the dialog can access them
      this.fileSystemService.currentFilePath = tab.filePath;
      this.fileSystemService['configService'].setActiveComponentType(
        'covisualization',
      );

      // Wait for Angular to render the covisualization component before showing the dialog
      // This ensures the save dialog method is available
      setTimeout(() => {
        // Close file with save dialog and tab cleanup
        this.fileSystemService.closeFile(() => {
          // After closing, restore the previously active tab if it still exists
          if (
            previousActiveTab &&
            this.tabManager.getTab(previousActiveTab.id)
          ) {
            this.tabManager.setActiveTab(previousActiveTab.id);
          }
        }, tab.id);
      }, 150); // Increased delay to ensure component is fully rendered
    } else {
      // For visualization or empty tabs, close directly
      this.tabManager.closeTab(tab.id);

      // If no tabs left, show welcome screen by closing file
      if (!this.tabManager.hasOpenTabs()) {
        this.fileSystemService.closeFile();
      }
    }
  }

  /**
   * Handle new tab button click
   */
  onNewTabClick(): void {
    this.tabManager.createNewTab();
  }

  /**
   * Handle open file for active tab
   * Delegates to existing menu service
   */
  onOpenFileClick(): void {
    this.menuService.openFileDialog(() => {});
  }

  /**
   * Get display title for tab (truncate long names)
   */
  getDisplayTitle(tab: Tab): string {
    const maxLength = 25;
    return tab.title.length <= maxLength
      ? tab.title
      : tab.title.substring(0, maxLength - 3) + '...';
  }

  /**
   * Track by function for performance
   */
  trackByTabId(_index: number, tab: Tab): string {
    return tab.id;
  }
}
