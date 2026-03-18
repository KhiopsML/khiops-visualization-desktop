/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
import { Injectable } from '@angular/core';

type OS = 'mac' | 'windows';

@Injectable({ providedIn: 'root' })
export class StartPanelService {
  private readonly currentOS: OS = this.detectOS();

  getOpenFileShortcut(): { keys: string[]; description: string } {
    const keys = this.currentOS === 'mac' ? ['Cmd', 'O'] : ['Ctrl', 'O'];
    return {
      keys,
      description: 'OPEN_A_FILE_FROM_THE_MENU',
    };
  }

  getCurrentOS(): OS {
    return this.currentOS;
  }

  private detectOS(): OS {
    return navigator.userAgent.toLowerCase().includes('mac')
      ? 'mac'
      : 'windows';
  }
}
