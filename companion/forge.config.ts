import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'generated/jena-companion.ico',
    executableName: 'JENA Companion',
    extraResource: ['generated/tray.png'],
  },
  makers: [
    new MakerSquirrel({
      name: 'JENACompanion',
      setupIcon: 'generated/jena-companion.ico',
      setupExe: 'JENA Companion Setup.exe',
      noMsi: true,
    }),
  ],
}

export default config
