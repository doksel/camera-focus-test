import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { CameraView as ExpoCameraView } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import {
    Extrapolation,
    cancelAnimation,
    interpolate,
    runOnJS,
    useAnimatedReaction,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import LoadingIndicatorNew from '../Global/LoadingIndicatorNew';
import { appService } from '../../services';

export interface QuestionCameraPhoto {
    uri: string;
    width: number;
    height: number;
}

interface CameraViewProps {
    visible: boolean;
    onClose: () => void;
    onCapture: (photo: QuestionCameraPhoto) => Promise<void>;
    cameraIsCapturing: boolean;
    showLoader: boolean;
}

const MAX_ZOOM = 1;
const PINCH_SCALE_FULL_ZOOM = 3;

const ZoomDisplay = React.memo<{ zoomValue: number; onPress: () => void }>(({ zoomValue, onPress }) => {
    const displayZoom = 1 + zoomValue * 4;
    return (
        <TouchableOpacity style={styles.zoomIndicator} onPress={onPress} activeOpacity={0.7}>
            <Text style={styles.zoomIndicatorText}>{displayZoom.toFixed(1)}x</Text>
        </TouchableOpacity>
    );
});

const CameraView: React.FC<CameraViewProps> = ({ visible, onClose, onCapture, cameraIsCapturing, showLoader }) => {
    const cameraRef = useRef<ExpoCameraView>(null);
    const [flash, setFlash] = useState<'auto' | 'on' | 'off'>('auto');
    const [focusIndicator, setFocusIndicator] = useState<{ x: number; y: number; visible: boolean }>({
        x: 0,
        y: 0,
        visible: false,
    });
    const focusIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);

    const zoom = useSharedValue(0);
    const baseZoom = useSharedValue(0);
    const [zoomValue, setZoomValue] = useState(0);

    const lastDisplayedZoom = useSharedValue(0);

    useAnimatedReaction(
        () => zoom.value,
        (currentValue, previousValue) => {
            'worklet';
            if (previousValue === null) {
                runOnJS(setZoomValue)(currentValue);
                lastDisplayedZoom.value = currentValue;
                return;
            }

            const zoomDiff = Math.abs(currentValue - lastDisplayedZoom.value);

            if (zoomDiff >= 0.005) {
                runOnJS(setZoomValue)(currentValue);
                lastDisplayedZoom.value = currentValue;
            }
        }
    );

    useEffect(() => {
        if (visible) {
            cancelAnimation(zoom);
            zoom.value = 0;
            baseZoom.value = 0;
            lastDisplayedZoom.value = 0;
            setZoomValue(0);
            setFocusIndicator({ x: 0, y: 0, visible: false });
            setIsCapturing(false);
        }
    }, [baseZoom, lastDisplayedZoom, visible, zoom]);

    useEffect(() => {
        return () => {
            if (focusIndicatorTimeoutRef.current) {
                clearTimeout(focusIndicatorTimeoutRef.current);
            }
            if (refocusTimeoutRef.current) {
                clearTimeout(refocusTimeoutRef.current);
            }
        };
    }, []);

    const toggleZoom = useCallback(() => {
        const zoomStops = [0, 0.25, 0.5, MAX_ZOOM];
        const currentZoom = zoom.value;
        const nextLevel = zoomStops.find(level => level > currentZoom + 0.01) ?? zoomStops[0];
        zoom.value = withTiming(nextLevel, { duration: 200 });
        baseZoom.value = nextLevel;
    }, [baseZoom, zoom]);

    const toggleFlash = useCallback(() => {
        setFlash(prev => {
            if (prev === 'auto') return 'on';
            if (prev === 'on') return 'off';
            return 'auto';
        });
    }, []);

    // VARIANT B: expo-camera has no focus-at-point API. Workaround: toggle
    // autofocus off -> on so the camera re-runs its (centre-weighted) autofocus.
    // The tap position is still NOT used by the camera — only by the indicator.
    const [autofocus, setAutofocus] = useState<'on' | 'off'>('on');
    const refocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleTapToFocus = useCallback((x: number, y: number) => {
        setFocusIndicator({ x, y, visible: true });

        setAutofocus('off');
        if (refocusTimeoutRef.current) clearTimeout(refocusTimeoutRef.current);
        refocusTimeoutRef.current = setTimeout(() => setAutofocus('on'), 100);

        if (focusIndicatorTimeoutRef.current) {
            clearTimeout(focusIndicatorTimeoutRef.current);
        }
        focusIndicatorTimeoutRef.current = setTimeout(() => {
            setFocusIndicator(prev => ({ ...prev, visible: false }));
        }, 1000);
    }, []);

    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            'worklet';
            baseZoom.value = zoom.value;
        })
        .onUpdate(e => {
            'worklet';
            const pinchScale = interpolate(
                e.scale,
                [1 / PINCH_SCALE_FULL_ZOOM, 1, PINCH_SCALE_FULL_ZOOM],
                [-1, 0, 1],
                Extrapolation.CLAMP
            );

            zoom.value = interpolate(
                pinchScale,
                [-1, 0, 1],
                [0, baseZoom.value, MAX_ZOOM],
                Extrapolation.CLAMP
            );
        })
        .onEnd(() => {
            'worklet';
            baseZoom.value = zoom.value;
        });

    const tapGesture = Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(e => {
            'worklet';
            runOnJS(handleTapToFocus)(e.x, e.y);
        });

    const composedGesture = Gesture.Simultaneous(pinchGesture, tapGesture);

    const flashIconName = useMemo(() => {
        if (flash === 'auto') return 'flash-auto';
        if (flash === 'on') return 'flash-on';
        return 'flash-off';
    }, [flash]);

    const handleCapture = useCallback(async () => {
        if (cameraIsCapturing || isCapturing || showLoader || !cameraRef.current) return;

        try {
            setIsCapturing(true);
            const photo = await cameraRef.current.takePictureAsync({ exif: true });
            if (photo) {
                await onCapture({ uri: photo.uri, width: photo.width, height: photo.height });
            }
        } catch (error) {
            console.error('Camera capture error:', error);
        } finally {
            setIsCapturing(false);
        }
    }, [cameraIsCapturing, isCapturing, onCapture, showLoader]);

    const isCaptureDisabled = cameraIsCapturing || isCapturing || showLoader;

    if (!visible) return null;

    return (
        <Modal animationType="slide" visible={visible} transparent={false} onRequestClose={onClose}>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <View style={styles.cameraScreenContainer}>
                    <View style={styles.cameraHeader}>
                        <TouchableOpacity
                            onPress={toggleFlash}
                            style={styles.flashButton}>
                            <MaterialIcons name={flashIconName} style={styles.flashIcon} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.cameraArea}>
                        <GestureDetector gesture={composedGesture}>
                            <View style={{ flex: 1 }}>
                                <ExpoCameraView
                                    flash={flash}
                                    ref={cameraRef}
                                    style={styles.camera}
                                    facing="back"
                                    zoom={zoomValue}
                                    autofocus={autofocus}
                                >
                                    <View style={styles.zoomContainer} pointerEvents="box-none">
                                        <ZoomDisplay zoomValue={zoomValue} onPress={toggleZoom} />
                                    </View>

                                    {focusIndicator.visible ? (
                                        <View
                                            style={[
                                                styles.focusIndicator,
                                                {
                                                    left: focusIndicator.x - 30,
                                                    top: focusIndicator.y - 30,
                                                },
                                            ]}
                                            pointerEvents="none"
                                        />
                                    ) : null}
                                </ExpoCameraView>
                            </View>
                        </GestureDetector>
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
    cameraScreenContainer: {
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
    },
    cameraHeader: {
        height: 80,
        backgroundColor: '#000',
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        paddingRight: 20,
        paddingBottom: 10,
    },
    cameraArea: {
        flex: 1,
        width: '100%',
        overflow: 'hidden',
    },
    camera: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
    cameraFooter: {
        height: 120,
        backgroundColor: '#000',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 30,
        paddingBottom: 20,
    },
    footerLeft: {
        width: 60,
    },
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
    captureButtonInner: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: 'white',
    },
    exitButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    exitButtonIcon: {
        fontSize: 24,
        color: 'white',
    },
    flashButton: {
        backgroundColor: 'rgba(255,255,255,0.3)',
        padding: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 24,
    },
    disabledControl: {
        opacity: 0.45,
    },
    flashIcon: { fontSize: 28, color: 'white' },
    zoomContainer: {
        position: 'absolute',
        bottom: 20,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 1000,
        elevation: 1000,
    },
    zoomIndicator: {
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    zoomIndicatorText: {
        color: 'white',
        fontSize: 18,
        fontWeight: '600',
    },
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

export default CameraView;
