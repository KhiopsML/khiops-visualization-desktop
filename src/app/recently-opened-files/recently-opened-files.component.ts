/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { FileSystemService } from '../core/services/file-system.service';
import { MenuService } from '../core/services/menu.service';
import { Subscription } from 'rxjs';
import {
  LucideClock3,
  LucideSearch,
  LucideFile,
  LucideFileJson2,
} from '@lucide/angular';

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
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    CommonModule,
    TranslatePipe,
    LucideClock3,
    LucideSearch,
    LucideFile,
    LucideFileJson2,
  ],
})
export class RecentlyOpenedFilesComponent implements OnInit, OnDestroy {
  recentFiles: RecentFileItem[] = [];
  filterValue = '';
  private recentFilesChangedSubscription?: Subscription;

  constructor(
    private fileSystemService: FileSystemService,
    private menuService: MenuService,
  ) {}

  ngOnInit(): void {
    this.loadRecentFiles();

    // Subscribe to recent files list changes (when history is updated)
    // NOTE: Only reload when history changes, not on every file loader state change
    // This prevents the recent files from disappearing when a file is closed
    this.recentFilesChangedSubscription =
      this.fileSystemService.recentFilesChanged$.subscribe(() => {
        this.loadRecentFiles();
      });
  }

  ngOnDestroy(): void {
    this.recentFilesChangedSubscription?.unsubscribe();
  }

  private loadRecentFiles(): void {
    this.recentFiles = this.fileSystemService.getRecentFiles();
  }

  get filteredRecentFiles(): RecentFileItem[] {
    const normalizedFilter = this.filterValue.trim().toLowerCase();
    if (!normalizedFilter) {
      return this.recentFiles;
    }

    return this.recentFiles.filter((file) => {
      return (
        file.filename.toLowerCase().includes(normalizedFilter) ||
        file.path.toLowerCase().includes(normalizedFilter)
      );
    });
  }

  onFilterInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.filterValue = target?.value ?? '';
  }

  showFallbackIcon(file: RecentFileItem): boolean {
    return (
      file.fileType !== 'visualization' && file.fileType !== 'covisualization'
    );
  }

  isJsonFile(filename: string): boolean {
    return filename.toLowerCase().endsWith('.json');
  }

  openFile(filePath: string): void {
    // Use MenuService.openFile to ensure menu is rebuilt after opening
    this.menuService.openFile(filePath);
  }
}
