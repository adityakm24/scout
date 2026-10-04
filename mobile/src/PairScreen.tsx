import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { type Pairing, parsePairingLink } from './pairing'
import { colors } from './theme'

/** First run: connect this phone to a Scout by scanning its pairing QR (or pasting the link). */
export function PairScreen({ onPaired }: { onPaired: (pairing: Pairing) => void }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const done = useRef(false)

  const accept = (text: string) => {
    const pairing = parsePairingLink(text)

    if (!pairing) {
      setError('That isn’t a Scout pairing link.')

      return
    }

    if (!done.current) {
      done.current = true
      onPaired(pairing)
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Connect to Scout</Text>
      <Text style={styles.body}>Scan the pairing code from Scout on your computer.</Text>

      <View style={styles.camera}>
        {permission?.granted ? (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => accept(data)}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Pressable onPress={requestPermission} style={styles.button}>
            <Text style={styles.buttonText}>Allow camera to scan</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.body}>Or paste the pairing link</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={value => {
          setLink(value)
          setError('')
        }}
        onSubmitEditing={() => accept(link)}
        placeholder="http://…?token=…"
        placeholderTextColor={colors.textTertiary}
        returnKeyType="go"
        style={styles.input}
        value={link}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  button: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  camera: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: colors.card,
    borderRadius: 24,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%'
  },
  error: { color: colors.red, fontSize: 14 },
  input: {
    backgroundColor: colors.card,
    borderRadius: 999,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 18,
    paddingVertical: 12,
    width: '100%'
  },
  screen: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' }
})
