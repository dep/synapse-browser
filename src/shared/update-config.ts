// Sparkle-protocol update feed. The public key is the same EdDSA key that
// signs synapse-commander updates (one key, both apps); the private half
// lives only in the login keychain of the release machine.
export const APPCAST_URL = 'https://raw.githubusercontent.com/dep/synapse-browser/main/appcast.xml'
export const SU_PUBLIC_KEY = 'Tnoq0NNryfeGcjS0eQ2xfuOuvqf4dRoa3wF86ljVZh4='
