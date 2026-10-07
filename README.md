# Camera focus test

Test bench for the Priority technical question: *"Client is complaining that focus does not work in the camera."*
Same versions as the production app: **Expo SDK 52, React Native 0.76.9, expo-camera 16**.

## What's inside

| Button | File | What it shows |
|---|---|---|
| Original (bug) | `src/components/Camera/CameraView.tsx` | The original component, **unchanged**. Reproduces the bug: the white circle is drawn on tap, but the camera does not refocus. |
| A: system camera | `App.tsx` → `ImagePicker.launchCameraAsync` | The OS camera app: real tap-to-focus, flash, zoom. Lowest risk, but the camera UI depends on the device. |
| B: VisionCamera | `src/components/Camera/VisionCameraView.tsx` | `react-native-vision-camera`: `camera.focus({ x, y })` at the tapped point, flash, zoom on the UI thread. Same props and the same white focus circle as the original, so it is a drop-in replacement. |

`src/components/Global/LoadingIndicatorNew.tsx` and `src/services/index.ts` are stubs so the original file runs with its imports untouched.
`src/components/Preview/ZoomableImage.tsx` is a test-bench helper for inspecting the captured photo (pinch / drag / double-tap); it is not part of the fix.

**Also tried:** keeping `expo-camera` and toggling `autofocus` `off` → `on` on tap to force a refocus. `expo-camera` (SDK 52) has no focus-at-point API, so the tap position is not used. On a real device (Xiaomi 24117RN76E) the camera did not refocus, so this approach was dropped. The code is in the first commit (`git show 2b523a3:src/components/Camera/CameraViewRefocus.tsx`).

**Tested on Android only** (Xiaomi 24117RN76E). iOS was not tested because I don't have an iPhone available. The iOS run steps below are provided but unverified.

## Running

The camera does not work in a simulator, and Expo Go no longer supports SDK 52, so you need a **dev build on a real phone**.

```bash
cd CameraFocusTest
npm install

# Android: phone connected via USB (or adb over Wi-Fi), USB debugging enabled
npm run android

# iOS (not tested): iPhone connected, Xcode installed, signing Team selected in Xcode
npm run ios
```

`expo run` runs `prebuild` automatically (generates `ios/` and `android/` with the camera native plugins).
After changing `app.json` or native dependencies, rebuild: `npx expo prebuild --clean`, then `run` again.
