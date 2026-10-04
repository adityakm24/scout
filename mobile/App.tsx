import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { prepareActivityChannels } from './src/activity'
import { forgetPairing, loadPairing, type Pairing, pairingFromDeepLink, savePairing } from './src/pairing'
import { PairScreen } from './src/PairScreen'
import { ScoutScreen } from './src/ScoutScreen'
import { colors } from './src/theme'

export default function App() {
  // undefined while the saved pairing is read; null when this phone is not paired yet.
  const [pairing, setPairing] = useState<null | Pairing | undefined>(undefined)

  const pair = (next: Pairing) => {
    setPairing(next)
    void savePairing(next)
  }

  useEffect(() => {
    void prepareActivityChannels()
  }, [])

  useEffect(() => {
    // A pairing deep link (a QR scanned with the Camera app) pairs on open, else the saved one.
    void Linking.getInitialURL().then(async url => {
      const linked = url ? pairingFromDeepLink(url) : null

      if (linked) {
        pair(linked)
      } else {
        setPairing(await loadPairing())
      }
    })

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const linked = pairingFromDeepLink(url)

      if (linked) {
        pair(linked)
      }
    })

    return () => subscription.remove()
  }, [])

  const unpair = () => {
    setPairing(null)
    void forgetPairing()
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        {pairing === undefined ? null : pairing ? (
          <ScoutScreen onUnpair={unpair} pairing={pairing} />
        ) : (
          <PairScreen onPaired={pair} />
        )}
      </View>
    </SafeAreaProvider>
  )
}
