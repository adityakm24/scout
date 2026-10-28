// Personal (free) Apple development teams cannot enable Push Notifications. expo-notifications
// and expo-live-activity add aps-environment during prebuild; strip it so `expo run:ios --device` works.
const { withEntitlementsPlist } = require('expo/config-plugins')

module.exports = function withIosPersonalTeam(config) {
  return withEntitlementsPlist(config, mod => {
    delete mod.modResults['aps-environment']
    return mod
  })
}
