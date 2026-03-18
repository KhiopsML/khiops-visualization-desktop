import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
    private readonly menuService: MenuService,
  ) {}

  ngOnInit(): void {
    // Detect OS and set shortcut dynamically
    const isMac = /mac/i.test(navigator.userAgent);
    const keys = isMac ? ['Cmd', 'O'] : ['Ctrl', 'O'];
    this.shortcut = {
      keys,
      description: 'OPEN_A_FILE_FROM_THE_MENU',
    };
  }

  getKeyDisplay(key: string): string {
    return this.keySymbols[key] ?? key;
  }

  openFile(): void {
    this.menuService.openFileDialog();
  }
}
