/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabManagerService } from '../core/services/tab-manager.service';
import { MenuService } from '../core/services/menu.service';
import { FileSystemService } from '../core/services/file-system.service';
import { TabDragService } from '../core/services/tab-drag.service';
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
    private tabDrag: TabDragService,
  ) {}

  ngOnInit(): void {
    this.tabManager.tabState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.tabs = state.tabs;
        this.activeTabId = state.activeTabId;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Handle tab pointer down to start drag
   */
  onTabPointerDown(event: PointerEvent, tab: Tab, tabEl: HTMLElement): void {
    this.tabDrag.startDrag(event, tab.id, tabEl);
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
    this.tabManager.closeTab(tab.id);
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
