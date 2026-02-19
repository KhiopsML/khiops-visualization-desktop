/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Component, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FileSystemService } from '../core/services/file-system.service';
import { Subscription } from 'rxjs';
import { FileLoaderI } from '../interfaces/file-system';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
  standalone: true,
  imports: [CommonModule, TranslateModule],
})
export class WelcomeComponent implements OnInit, OnDestroy {
  private fileLoaderSub?: Subscription;

  visible: boolean = true;

  constructor(
    public fileSystemService: FileSystemService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    this.fileLoaderSub?.unsubscribe();
  }

  ngOnInit(): void {
    this.fileLoaderSub = this.fileSystemService.fileLoader$.subscribe(
      (res: FileLoaderI) => {
        this.visible = false;
        if (res?.datas && !res.isLoadingDatas) {
          this.visible = false;
        } else {
          this.visible = true;
        }
        this.cdr.detectChanges();
      },
    );
  }
}
