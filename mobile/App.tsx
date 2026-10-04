import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { forgetPairing, loadPairing, type Pairing, savePairing } from './src/pairing'
import { PairScreen } from './src/PairScreen'
import { ScoutScreen } from './src/ScoutScreen'
import { colors } from './src/theme'

export default function App() {
  // undefined while the saved pairing is read; null when this phone is not paired yet.
  const [pairing, setPairing] = useState<null | Pairing | undefined>(undefined)

  useEffect(() => {
    void loadPairing().then(setPairing)
  }, [])

  const pair = (next: Pairing) => {
    setPairing(next)
    void savePairing(next)
  }

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
