// Wird nur in der Android-App (www/) eingebunden und stellt die nativen Plugins bereit.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

window.GGNative = Capacitor.isNativePlatform()
  ? { Capacitor, LocalNotifications, Filesystem, Directory, Encoding, Share, App }
  : null;
