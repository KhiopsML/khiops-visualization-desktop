/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { FileSystemService } from '../core/services/file-system.service';
import { Subscription } from 'rxjs';
import { FileLoaderI } from '../interfaces/file-system.interface';

@Component({
  selector: 'app-big-file-loading',
  templateUrl: './big-file-loading.component.html',
  styleUrl: './big-file-loading.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [CommonModule, TranslatePipe],
})
export class BigFileLoadingComponent implements OnInit, OnDestroy {
  private fileLoaderSub?: Subscription;
  private hideLoaderTimeoutId?: ReturnType<typeof setTimeout>;

  visible: boolean = false;
  isTextVisible: boolean = false;

  constructor(
    public fileSystemService: FileSystemService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    if (this.hideLoaderTimeoutId) {
      clearTimeout(this.hideLoaderTimeoutId);
      this.hideLoaderTimeoutId = undefined;
    }
    this.fileLoaderSub?.unsubscribe();
  }

  ngOnInit(): void {
    this.fileLoaderSub = this.fileSystemService.fileLoader$.subscribe(
      (res: FileLoaderI) => {
        if (res?.isLoadingDatas) {
          if (this.hideLoaderTimeoutId) {
            clearTimeout(this.hideLoaderTimeoutId);
            this.hideLoaderTimeoutId = undefined;
          }
          this.visible = true;
        } else {
          this.hideLoaderTimeoutId = setTimeout(() => {
            this.visible = false;
            this.hideLoaderTimeoutId = undefined;
            this.cdr.detectChanges();
          }, 1000); // important to display animated logo everytimes
        }
        this.isTextVisible = !!res?.isBigJsonFile;
        this.cdr.detectChanges();
      },
    );
  }
}
