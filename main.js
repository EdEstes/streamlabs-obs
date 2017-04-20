'use strict';

////////////////////////////////////////////////////////////////////////////////
// Set Up Environment Variables
////////////////////////////////////////////////////////////////////////////////
const pjson = require('./package.json');
if (pjson.env === 'production') {
  process.env.NODE_ENV = 'production';
}
process.env.SLOBS_VERSION = pjson.version;

////////////////////////////////////////////////////////////////////////////////
// Modules and other Requires
////////////////////////////////////////////////////////////////////////////////
const inAsar = process.mainModule.filename.indexOf('app.asar') !== -1;
const { app, BrowserWindow, ipcMain } = require('electron');
const _ = require('lodash');
const obs = require(inAsar ? '../../node-obs' : './node-obs');
const { autoUpdater } = require('electron-updater');

////////////////////////////////////////////////////////////////////////////////
// Main Program
////////////////////////////////////////////////////////////////////////////////

// Windows
let mainWindow;
let childWindow;

// Somewhat annoyingly, this is needed so that the child window
// can differentiate between a user closing it vs the app
// closing the windows before exit.
let appExiting = false;

const indexUrl = 'file://' + __dirname + '/index.html';

// Returns a promise that is resolved if there was no update
// to install.  If there was un update, the app will quit and
// be updated.
function runAutoUpdater() {
  return new Promise(resolve => {
    console.log("RUNNING AUTO UPDATE");

    autoUpdater.on('checking-for-update', () => {
      console.log('CHECKING FOR UPDATES...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('FOUND UPDATE!', info);
    });

    autoUpdater.on('update-not-available', () => {
      console.log('NO UPDATE IS AVAILABLE!');
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log('DOWNLOADING... ', progress);
    });

    autoUpdater.on('update-downloaded', () => {
      console.log('SUCCESSFULLY DOWNLOADED NEW VERSION!');
    });

    autoUpdater.checkForUpdates();
  });
}

function startApp() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false
  });

  mainWindow.setMenu(null);

  mainWindow.loadURL(indexUrl);

  mainWindow.on('close', e => {
    if (!appExiting) {
      appExiting = true;
      mainWindow.send('shutdown');
      e.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    app.quit();
  });

  // Pre-initialize the child window
  childWindow = new BrowserWindow({
    show: false
  });

  childWindow.setMenu(null);

  // The child window is never closed, it just hides in the
  // background until it is needed.
  childWindow.on('close', e => {
    if (!appExiting) {
      childWindow.send('closeWindow');

      // Prevent the window from actually closing
      e.preventDefault();
    }
  });

  childWindow.loadURL(indexUrl + '?child=true');

  if (process.env.NODE_ENV !== 'production') {
    childWindow.webContents.openDevTools();
    mainWindow.webContents.openDevTools();

    const devtoolsInstaller = require('electron-devtools-installer');

    devtoolsInstaller.default(devtoolsInstaller.VUEJS_DEVTOOLS);
  }

  // Initialize various OBS services
  obs.OBS_API_initOBS_API();
  obs.OBS_API_openAllModules();
  obs.OBS_API_initAllModules();

  obs.OBS_service_createStreamingOutput();
  obs.OBS_service_createRecordingOutput();

  obs.OBS_service_createVideoStreamingEncoder();
  obs.OBS_service_createVideoRecordingEncoder();

  obs.OBS_service_createAudioEncoder();

  obs.OBS_service_resetAudioContext();
  obs.OBS_service_resetVideoContext();

  obs.OBS_service_associateAudioAndVideoToTheCurrentStreamingContext();
  obs.OBS_service_associateAudioAndVideoToTheCurrentRecordingContext();

  obs.OBS_service_createService();

  obs.OBS_service_associateAudioAndVideoEncodersToTheCurrentStreamingOutput();
  obs.OBS_service_associateAudioAndVideoEncodersToTheCurrentRecordingOutput();

  obs.OBS_service_setServiceToTheStreamingOutput();
}

app.on('ready', () => {
  if ((process.env.NODE_ENV === 'production') || process.env.SLOBS_FORCE_AUTO_UPDATE) {
    runAutoUpdater().then(() => startApp());
  } else {
    startApp();
  }
});

ipcMain.on('window-showChildWindow', (event, data) => {
  if (data.windowOptions.width && data.windowOptions.height) {
    childWindow.setSize(data.windowOptions.width, data.windowOptions.height);
    childWindow.center();
  }

  childWindow.send('window-setContents', data.startupOptions);
  childWindow.show();
});

// The main process acts as a hub for various windows
// syncing their vuex stores.
let registeredStores = {};

ipcMain.on('vuex-register', event => {
  let win = BrowserWindow.fromWebContents(event.sender);
  let windowId = win.id;

  // Register can be received multiple times if the window is
  // refreshed.  We only want to register it once.
  if (!registeredStores[windowId]) {
    registeredStores[windowId] = win;
    console.log('Registered vuex stores: ', _.keys(registeredStores));

    // Make sure we unregister is when it is closed
    win.on('closed', () => {
      delete registeredStores[windowId];
      console.log('Registered vuex stores: ', _.keys(registeredStores));
    });
  }

  if (windowId !== mainWindow.id) {
    // Tell the mainWindow to send its current store state
    // to the newly registered window

    mainWindow.webContents.send('vuex-sendState', windowId);
  }
});

// Proxy vuex-mutation events to all other subscribed windows
ipcMain.on('vuex-mutation', (event, mutation) => {
  let windowId = BrowserWindow.fromWebContents(event.sender).id;

  _.each(_.omit(registeredStores, [windowId]), win => {
    win.webContents.send('vuex-mutation', mutation);
  });
});

// Virtual node OBS calls:
//
// These are methods that appear upstream to be OBS
// API calls, but are actually Javascript functions.
// These should be used sparingly, and are used to
// ensure atomic operation of a handful of calls.
const nodeObsVirtualMethods = {

  // This needs to be done as a single IPC call, otherwise
  // there is visible judder in the display output.
  OBS_content_setSourcePositionAndScale(name, x, y, scaleX, scaleY) {
    obs.OBS_content_setSourcePosition(name, x, y);
    obs.OBS_content_setSourceScaling(name, scaleX, scaleY);
  }

};

// Proxy node OBS calls
ipcMain.on('obs-apiCall', (event, data) => {
  let retVal;

  console.log('OBS API CALL', data);

  if (nodeObsVirtualMethods[data.method]) {
    retVal = nodeObsVirtualMethods[data.method].apply(null, data.args);
  } else {
    retVal = obs[data.method].apply(obs, data.args);
  }

  console.log('OBS RETURN VALUE', retVal);

  // electron ipc doesn't like returning undefined, so
  // we return null instead.
  event.returnValue = retVal || null;
});

// Used for guaranteeing unique ids for objects in the vuex store
ipcMain.on('getUniqueId', event => {
  event.returnValue = _.uniqueId();
});
