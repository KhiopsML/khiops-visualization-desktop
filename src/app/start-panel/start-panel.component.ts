/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StartPanelService } from '../core/services/start-panel.service';
import { MenuService } from '../core/services/menu.service';
import { TranslateModule } from '@ngx-translate/core';

interface Shortcut {
  keys: string[];
  description: string;
}

@Component({
  selector: 'app-start-panel',
  templateUrl: './start-panel.component.html',
  styleUrl: './start-panel.component.scss',
  standalone: true,
  imports: [CommonModule, TranslateModule],
})
export class StartPanelComponent implements OnInit {
  shortcut: Shortcut | null = null;

  private readonly keySymbols: Record<string, string> = {
    Ctrl: 'Ctrl',
    Cmd: '⌘',
  };

  constructor(
    private readonly startPanelService: StartPanelService,
    private readonly menuService: MenuService,
  ) {}

  ngOnInit(): void {
    this.shortcut = this.startPanelService.getOpenFileShortcut();
  }

  getKeyDisplay(key: string): string {
    return this.keySymbols[key] ?? key;
  }

  openFile(): void {
    this.menuService.openFileDialog();
  }
}
