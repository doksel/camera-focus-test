// Test-bench helper (not part of the fix): pinch / pan / double-tap zoom for checking photo sharpness.
// ScrollView.maximumZoomScale is iOS-only, so on Android we do it with gesture-handler + reanimated.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MAX_SCALE = 8;

export default function ZoomableImage({ uri }: { uri: string }) {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);

    const reset = () => {
        'worklet';
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
    };

    const pinch = Gesture.Pinch()
        .onUpdate(e => {
            scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
        })
        .onEnd(() => {
            savedScale.value = scale.value;
            if (scale.value <= 1.01) reset();
        });

    const pan = Gesture.Pan()
        .averageTouches(true)
        .onUpdate(e => {
            tx.value = savedTx.value + e.translationX;
            ty.value = savedTy.value + e.translationY;
        })
        .onEnd(() => {
            savedTx.value = tx.value;
            savedTy.value = ty.value;
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            if (scale.value > 1) {
                reset();
            } else {
                scale.value = withTiming(4);
                savedScale.value = 4;
            }
        });

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }));

    return (
        <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
            <Animated.Image source={{ uri }} style={[StyleSheet.absoluteFill, style]} resizeMode="contain" />
        </GestureDetector>
    );
}
