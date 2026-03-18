/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FileSystemService } from '../core/services/file-system.service';
import { MenuService } from '../core/services/menu.service';
import { Subscription } from 'rxjs';

interface RecentFileItem {
  path: string;
  filename: string;
  size: number;
  sizeDisplay: string;
  fileType: 'visualization' | 'covisualization';
}

@Component({
  selector: 'app-recently-opened-files',
  templateUrl: './recently-opened-files.component.html',
  styleUrl: './recently-opened-files.component.scss',
  standalone: true,
  imports: [CommonModule, TranslateModule],
})
export class RecentlyOpenedFilesComponent implements OnInit, OnDestroy {
  recentFiles: RecentFileItem[] = [];
  private recentFilesSubscription?: Subscription;
  private recentFilesChangedSubscription?: Subscription;

  constructor(
    private fileSystemService: FileSystemService,
    private menuService: MenuService,
  ) {}

  ngOnInit(): void {
    this.loadRecentFiles();

    // Subscribe to file loader changes
    this.recentFilesSubscription = this.fileSystemService.fileLoader$.subscribe(
      () => {
        this.loadRecentFiles();
      },
    );

    // Subscribe to recent files list changes (when history is updated)
    this.recentFilesChangedSubscription =
      this.fileSystemService.recentFilesChanged$.subscribe(() => {
        this.loadRecentFiles();
      });
  }

  ngOnDestroy(): void {
    this.recentFilesSubscription?.unsubscribe();
    this.recentFilesChangedSubscription?.unsubscribe();
  }

  private loadRecentFiles(): void {
    this.recentFiles = this.fileSystemService.getRecentFiles();
  }

  openFile(filePath: string): void {
    // Use MenuService.openFile to ensure menu is rebuilt after opening
    this.menuService.openFile(filePath);
  }
}
