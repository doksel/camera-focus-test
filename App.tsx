// Test bench: compare the original camera with three fix variants on one device.
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import OriginalCameraView, { QuestionCameraPhoto } from './src/components/Camera/CameraView';
import VisionCameraView from './src/components/Camera/VisionCameraView';
import ZoomableImage from './src/components/Preview/ZoomableImage';

type Variant = 'original' | 'vision';
type ShotVariant = Variant | 'picker';

interface Shot extends QuestionCameraPhoto {
    id: string;
    variant: ShotVariant;
    takenAt: string;
}

const LABELS: Record<ShotVariant, string> = {
    original: 'Original (bug)',
    picker: 'A: system camera (ImagePicker)',
    vision: 'B: VisionCamera focus({x,y})',
};

export default function App() {
    const [expoPermission, requestExpoPermission] = useCameraPermissions();
    const [open, setOpen] = useState<Variant | null>(null);
    const [shots, setShots] = useState<Shot[]>([]);
    const [preview, setPreview] = useState<Shot | null>(null);

    const addShot = useCallback((variant: ShotVariant, photo: QuestionCameraPhoto) => {
        setShots(prev => [
            { ...photo, variant, id: `${Date.now()}`, takenAt: new Date().toLocaleTimeString() },
            ...prev,
        ]);
    }, []);

    const openExpoCamera = async (variant: Variant) => {
        if (!expoPermission?.granted) {
            const res = await requestExpoPermission();
            if (!res.granted) return;
        }
        setOpen(variant);
    };

    const openPicker = async () => {
        try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
                Alert.alert('Camera permission', `status: ${perm.status}, canAskAgain: ${perm.canAskAgain}`);
                return;
            }
            const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
            if (!res.canceled && res.assets[0]) {
                const a = res.assets[0];
                addShot('picker', { uri: a.uri, width: a.width, height: a.height });
            }
        } catch (e) {
            console.error('[Picker] error', e);
            Alert.alert('ImagePicker error', String(e));
        }
    };

    const onCapture = useCallback(
        async (photo: QuestionCameraPhoto) => {
            if (open) addShot(open, photo);
            setOpen(null);
        },
        [open, addShot]
    );

    const close = () => setOpen(null);

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaView style={styles.container}>
                <StatusBar style="dark" />
                <Text style={styles.title}>Camera focus test</Text>
                <Text style={styles.hint}>Same object, same distance (10/15/20/30 cm, 1 m) in every variant.</Text>

                <Button label={LABELS.original} onPress={() => openExpoCamera('original')} danger />
                <Button label={LABELS.picker} onPress={openPicker} />
                <Button label={LABELS.vision} onPress={() => setOpen('vision')} />

                <Text style={styles.section}>Shots ({shots.length}) — tap to inspect at full size</Text>
                <FlatList
                    data={shots}
                    keyExtractor={s => s.id}
                    renderItem={({ item }) => (
                        <Pressable style={styles.shot} onPress={() => setPreview(item)}>
                            <Image source={{ uri: item.uri }} style={styles.thumb} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.shotTitle}>{LABELS[item.variant]}</Text>
                                <Text style={styles.shotMeta}>
                                    {item.width}×{item.height} · {item.takenAt}
                                </Text>
                            </View>
                        </Pressable>
                    )}
                />

                <OriginalCameraView visible={open === 'original'} onClose={close} onCapture={onCapture} cameraIsCapturing={false} showLoader={false} />
                <VisionCameraView visible={open === 'vision'} onClose={close} onCapture={onCapture} cameraIsCapturing={false} showLoader={false} />

                <Modal visible={!!preview} onRequestClose={() => setPreview(null)} animationType="fade">
                    {/* Modal is a separate native root on Android — gestures need their own root view */}
                    <GestureHandlerRootView style={styles.previewBg}>
                        <View style={{ flex: 1, overflow: 'hidden' }}>
                            {preview ? <ZoomableImage key={preview.id} uri={preview.uri} /> : null}
                        </View>
                        <Text style={styles.previewHint}>Pinch to zoom · drag to move · double-tap 4x / reset</Text>
                        <TouchableOpacity style={styles.previewClose} onPress={() => setPreview(null)}>
                            <Text style={{ color: 'white', fontSize: 16 }}>
                                Close · {preview ? `${LABELS[preview.variant]} · ${preview.width}×${preview.height}` : ''}
                            </Text>
                        </TouchableOpacity>
                    </GestureHandlerRootView>
                </Modal>
            </SafeAreaView>
        </GestureHandlerRootView>
    );
}

const Button = ({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) => (
    <TouchableOpacity style={[styles.btn, danger && styles.btnDanger]} onPress={onPress}>
        <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: '#fff' },
    title: { fontSize: 22, fontWeight: '700', marginTop: 8 },
    hint: { color: '#666', marginBottom: 12 },
    btn: { backgroundColor: '#1f6feb', padding: 14, borderRadius: 10, marginVertical: 5 },
    btnDanger: { backgroundColor: '#b62324' },
    btnText: { color: 'white', fontWeight: '600' },
    section: { marginTop: 16, marginBottom: 6, fontWeight: '600' },
    shot: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
    thumb: { width: 64, height: 64, borderRadius: 6, backgroundColor: '#eee' },
    shotTitle: { fontWeight: '600' },
    shotMeta: { color: '#666', fontSize: 12 },
    previewBg: { flex: 1, backgroundColor: '#000' },
    previewClose: { padding: 20, alignItems: 'center' },
    previewHint: { color: '#aaa', textAlign: 'center', fontSize: 12, paddingTop: 8 },
});
