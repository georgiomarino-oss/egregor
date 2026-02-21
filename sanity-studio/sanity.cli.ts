import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: 'wutlmydm',
    dataset: 'production'
  },
  studioHost: 'egregor',
  deployment: {
    appId: 'tyiwaetfj6mdtqhcuewmogux',
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    autoUpdates: true,
  }
})
