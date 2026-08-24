import type { ProxySettingsV1 } from '../storage/settings';
import {
  createProxyAuthContext,
  type ProxyAuthContextStore,
} from './auth';
import type {
  BrowserControlLevel,
  ProxySettingsAdapter,
} from './browser-adapter';
import { buildDesiredProxyState } from './config';
import { failure, success, type Result } from './errors';

export type ProxyControlState =
  | 'available'
  | 'owned'
  | 'controlled-by-other-extension'
  | 'not-controllable';

export interface ProxyMutationResult {
  action: 'set' | 'clear';
  control: ProxyControlState;
}

export class ProxyController {
  constructor(
    private readonly adapter: ProxySettingsAdapter,
    private readonly authContext: ProxyAuthContextStore,
  ) {}

  async getControlState(): Promise<ProxyControlState> {
    const snapshot = await this.adapter.get();
    return mapControlLevel(snapshot.levelOfControl);
  }

  async applyDesiredSettings(
    settings: ProxySettingsV1,
  ): Promise<Result<ProxyMutationResult>> {
    const desired = buildDesiredProxyState(settings);

    if (!desired.ok) {
      return desired;
    }

    if (desired.value.kind === 'disabled') {
      return this.disable();
    }

    const control = await this.getControlState();
    const controlError = getControlError(control);

    if (controlError !== null) {
      this.authContext.clearContext();
      return controlError;
    }

    this.authContext.clearContext();

    try {
      await this.adapter.set(desired.value.config);
      this.authContext.setContext(
        createProxyAuthContext(desired.value.parsedProxy, 'enabled-proxy'),
      );
      return success({ action: 'set', control });
    } catch {
      return failure(
        'PROXY_APPLY_FAILED',
        'Chrome failed to apply the proxy configuration.',
      );
    }
  }

  async disable(): Promise<Result<ProxyMutationResult>> {
    this.authContext.clearContext();
    const control = await this.getControlState();
    const controlError = getControlError(control);

    if (controlError !== null) {
      return controlError;
    }

    try {
      await this.adapter.clear();
      return success({ action: 'clear', control });
    } catch {
      return failure(
        'PROXY_CLEAR_FAILED',
        'Chrome failed to clear the proxy configuration.',
      );
    }
  }
}

export function mapControlLevel(
  level: BrowserControlLevel,
): ProxyControlState {
  switch (level) {
    case 'controllable_by_this_extension':
      return 'available';
    case 'controlled_by_this_extension':
      return 'owned';
    case 'controlled_by_other_extensions':
      return 'controlled-by-other-extension';
    case 'not_controllable':
      return 'not-controllable';
  }
}

function getControlError(
  control: ProxyControlState,
): Result<never> | null {
  switch (control) {
    case 'available':
    case 'owned':
      return null;
    case 'controlled-by-other-extension':
      return failure(
        'PROXY_CONTROLLED_BY_OTHER_EXTENSION',
        'Proxy settings are controlled by another extension.',
      );
    case 'not-controllable':
      return failure(
        'PROXY_NOT_CONTROLLABLE',
        'Proxy settings cannot be controlled by this extension.',
      );
  }
}
