// The Devices dialog's open state. Any screen opens it with openDevices(); the app shell renders it.
import { app } from '../../app.svelte.ts';

class DevicesDialogState {
  open = $state(false);
}
export const devicesDialog = new DevicesDialogState();

export function openDevices(): void {
  devicesDialog.open = true;
}
export function closeDevices(): void {
  devicesDialog.open = false;
  app.emit('devices-closed'); // h() screens (podcast, party) refresh their mic state on this
}

const CAMERA_KEY = 'cameraId';
/** The camera chosen last time (podcast recordings use it). */
export const savedCamera = (): string => {
  try {
    return localStorage.getItem(CAMERA_KEY) || '';
  } catch {
    return '';
  }
};
export const saveCamera = (id: string): void => {
  try {
    localStorage.setItem(CAMERA_KEY, id);
  } catch {}
};
