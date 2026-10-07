// Stub of the app's LoadingIndicatorNew — same props, minimal UI.
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const LoadingIndicatorNew: React.FC<{ msg?: string }> = ({ msg }) => (
    <View style={styles.overlay} pointerEvents="none">
        <ActivityIndicator color="white" size="large" />
        {msg ? <Text style={styles.text}>{msg}</Text> : null}
    </View>
);

const styles = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
    text: { color: 'white', marginTop: 8 },
});

export default LoadingIndicatorNew;
