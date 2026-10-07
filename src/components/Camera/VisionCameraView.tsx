// VARIANT B: react-native-vision-camera (v4) — real tap-to-focus at the tapped point,
// flash, native zoom driven on the UI thread (no React re-render per pinch frame),
// and a multi-lens virtual device so iOS can switch to the ultra-wide (macro) lens up close.
// Same props as the original CameraView, so it is a drop-in replacement.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    Camera,
    CameraCaptureError,
    useCameraDevice,
    useCameraFormat,
    useCameraPermission,
} from 'react-native-vision-camera';
import Reanimated, {
    runOnJS,
    useAnimatedProps,
    useAnimatedReaction,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialIcons } from '@expo/vector-icons';
import LoadingIndicatorNew from '../Global/LoadingIndicatorNew';
import { appService } from '../../services';
import type { QuestionCameraPhoto } from './CameraView';

Reanimated.addWhitelistedNativeProps({ zoom: true });
const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);

interface CameraViewProps {
    visible: boolean;
    onClose: () => void;
    onCapture: (photo: QuestionCameraPhoto) => Promise<void>;
    cameraIsCapturing: boolean;
    showLoader: boolean;
}

const MAX_ZOOM_FACTOR = 10; // cap digital zoom relative to the neutral (1x) lens

// Shows "1.0x" relative to neutralZoom. Lives in its own component so zoom updates
// re-render only this badge, never the camera.
const ZoomBadge: React.FC<{ zoom: SharedValue<number>; neutral: number; onPress: () => void }> = ({
    zoom,
    neutral,
    onPress,
}) => {
    const [label, setLabel] = useState('1.0x');
    useAnimatedReaction(
        () => Math.round((zoom.value / neutral) * 10) / 10,
        (curr, prev) => {
            if (curr !== prev) runOnJS(setLabel)(`${curr.toFixed(1)}x`);
        },
        [neutral]
    );
    return (
        <TouchableOpacity style={styles.zoomIndicator} onPress={onPress} activeOpacity={0.7}>
            <Text style={styles.zoomIndicatorText}>{label}</Text>
        </TouchableOpacity>
    );
};

const VisionCameraView: React.FC<CameraViewProps> = ({ visible, onClose, onCapture, cameraIsCapturing, showLoader }) => {
    const cameraRef = useRef<Camera>(null);
    const { hasPermission, requestPermission } = useCameraPermission();

    // Multi-cam virtual device (iPhone Pro: ultra-wide + wide + tele). Falls back to
    // whatever back camera exists on simpler phones / Android.
    const device = useCameraDevice('back', {
        physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
    });
    const format = useCameraFormat(device, [{ photoResolution: 'max' }]);

    const [flash, setFlash] = useState<'auto' | 'on' | 'off'>('auto');
    const [isCapturing, setIsCapturing] = useState(false);
    const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });
    const [lastFocusResult, setLastFocusResult] = useState<string>('—');
    const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const minZoom = device?.minZoom ?? 1;
    const neutralZoom = device?.neutralZoom ?? 1;
    const maxZoom = Math.min(device?.maxZoom ?? 1, neutralZoom * MAX_ZOOM_FACTOR);

    const zoom = useSharedValue(neutralZoom);
    const baseZoom = useSharedValue(neutralZoom);

    useEffect(() => {
        if (visible && !hasPermission) requestPermission();
    }, [visible, hasPermission, requestPermission]);

    // Reset state every time the modal opens (same behaviour as the original).
    useEffect(() => {
        if (visible) {
            zoom.value = neutralZoom;
            baseZoom.value = neutralZoom;
            setFocusIndicator({ x: 0, y: 0, visible: false });
            setIsCapturing(false);
            setLastFocusResult('—');
        }
    }, [visible, neutralZoom, zoom, baseZoom]);

    useEffect(() => () => {
        if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    }, []);

    const animatedProps = useAnimatedProps(() => ({ zoom: zoom.value }), [zoom]);

    const zoomStops = useMemo(() => {
        const stops = [0.5, 1, 2, 5].map(f => f * neutralZoom).filter(z => z >= minZoom && z <= maxZoom);
        return stops.length ? stops : [neutralZoom];
    }, [minZoom, maxZoom, neutralZoom]);

    const toggleZoom = useCallback(() => {
        const next = zoomStops.find(z => z > zoom.value + 0.01) ?? zoomStops[0];
        zoom.value = withTiming(next, { duration: 200 });
        baseZoom.value = next;
    }, [zoomStops, zoom, baseZoom]);

    const toggleFlash = useCallback(() => {
        setFlash(prev => (prev === 'auto' ? 'on' : prev === 'on' ? 'off' : 'auto'));
    }, []);

    const focusAt = useCallback(
        async (x: number, y: number) => {
            setFocusIndicator({ x, y, visible: true });
            if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
            focusTimeoutRef.current = setTimeout(() => setFocusIndicator(p => ({ ...p, visible: false })), 1000);

            if (!device?.supportsFocus) {
                setLastFocusResult('device does not support focus');
                return;
            }
            try {
                await cameraRef.current?.focus({ x, y });
                setLastFocusResult(`ok @ ${Math.round(x)},${Math.round(y)}`);
            } catch (e) {
                // A new tap before the previous focus finished cancels it — expected, not an error.
                if (e instanceof CameraCaptureError && e.code === 'capture/focus-canceled') {
                    setLastFocusResult('canceled by new tap');
                    return;
                }
                setLastFocusResult(`error: ${String(e)}`);
                console.warn('[VisionCamera] focus failed', e);
            }
        },
        [device]
    );

    const pinchGesture = Gesture.Pinch()
        .onBegin(() => {
            baseZoom.value = zoom.value;
        })
        .onUpdate(e => {
            zoom.value = Math.min(Math.max(baseZoom.value * e.scale, minZoom), maxZoom);
        })
        .onEnd(() => {
            baseZoom.value = zoom.value;
        });

    const tapGesture = Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(e => {
            runOnJS(focusAt)(e.x, e.y);
        });

    const composedGesture = Gesture.Simultaneous(pinchGesture, tapGesture);

    const flashIconName = flash === 'auto' ? 'flash-auto' : flash === 'on' ? 'flash-on' : 'flash-off';

    const handleCapture = useCallback(async () => {
        if (cameraIsCapturing || isCapturing || showLoader || !cameraRef.current) return;
        try {
            setIsCapturing(true);
            const photo = await cameraRef.current.takePhoto({ flash: device?.hasFlash ? flash : 'off' });
            await onCapture({ uri: `file://${photo.path}`, width: photo.width, height: photo.height });
        } catch (error) {
            console.error('Camera capture error:', error);
        } finally {
            setIsCapturing(false);
        }
    }, [cameraIsCapturing, isCapturing, showLoader, device, flash, onCapture]);

    const isCaptureDisabled = cameraIsCapturing || isCapturing || showLoader;

    if (!visible) return null;

    return (
        <Modal animationType="slide" visible={visible} transparent={false} onRequestClose={onClose}>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <View style={styles.cameraScreenContainer}>
                    <View style={styles.cameraHeader}>
                        <Text style={styles.debugText} numberOfLines={3}>
                            {device
                                ? `${device.physicalDevices.join(' + ')}\nminFocus: ${device.minFocusDistance ?? '?'} cm · focus: ${lastFocusResult}`
                                : 'No camera device'}
                        </Text>
                        <TouchableOpacity onPress={toggleFlash} style={styles.flashButton} disabled={!device?.hasFlash}>
                            <MaterialIcons name={flashIconName} style={styles.flashIcon} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.cameraArea}>
                        {device && hasPermission ? (
                            <GestureDetector gesture={composedGesture}>
                                <View style={{ flex: 1 }}>
                                    <ReanimatedCamera
                                        ref={cameraRef}
                                        style={StyleSheet.absoluteFill}
                                        device={device}
                                        format={format}
                                        isActive={visible}
                                        photo
                                        animatedProps={animatedProps}
                                    />
                                    <View style={styles.zoomContainer} pointerEvents="box-none">
                                        <ZoomBadge zoom={zoom} neutral={neutralZoom} onPress={toggleZoom} />
                                    </View>
                                    {focusIndicator.visible ? (
                                        <View
                                            pointerEvents="none"
                                            style={[styles.focusIndicator, { left: focusIndicator.x - 30, top: focusIndicator.y - 30 }]}
                                        />
                                    ) : null}
                                </View>
                            </GestureDetector>
                        ) : (
                            <View style={styles.center}>
                                <Text style={styles.debugText}>{hasPermission ? 'No back camera found' : 'Waiting for camera permission…'}</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.cameraFooter}>
                        <View style={styles.footerLeft} />
                        <TouchableOpacity
                            disabled={isCaptureDisabled}
                            style={[styles.captureButton, isCaptureDisabled && styles.disabledControl]}
                            onPress={handleCapture}>
                            <View style={styles.captureButtonInner} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.exitButton} onPress={onClose}>
                            <MaterialIcons name="close" style={styles.exitButtonIcon} />
                        </TouchableOpacity>
                        {showLoader && <LoadingIndicatorNew msg={appService.getTranslations('fileUploading')} />}
                    </View>
                </View>
            </GestureHandlerRootView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    cameraScreenContainer: { flex: 1, backgroundColor: '#000' },
    cameraHeader: {
        height: 80,
        backgroundColor: '#000',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        paddingHorizontal: 20,
        paddingBottom: 10,
    },
    debugText: { color: '#9f9', fontSize: 11, flex: 1, marginRight: 12 },
    cameraArea: { flex: 1, overflow: 'hidden' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    cameraFooter: {
        height: 120,
        backgroundColor: '#000',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 30,
        paddingBottom: 20,
    },
    footerLeft: { width: 60 },
    captureButton: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: 'white',
        borderWidth: 4,
        borderColor: 'rgba(255,255,255,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    captureButtonInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'white' },
    exitButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    exitButtonIcon: { fontSize: 24, color: 'white' },
    flashButton: { backgroundColor: 'rgba(255,255,255,0.3)', padding: 8, borderRadius: 24 },
    flashIcon: { fontSize: 28, color: 'white' },
    disabledControl: { opacity: 0.45 },
    zoomContainer: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center' },
    zoomIndicator: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    zoomIndicatorText: { color: 'white', fontSize: 18, fontWeight: '600' },
    focusIndicator: {
        position: 'absolute',
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: 2,
        borderColor: 'white',
        backgroundColor: 'transparent',
    },
});

export default VisionCameraView;
