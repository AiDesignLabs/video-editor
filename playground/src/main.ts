import { createApp } from 'vue'
import App from './App.vue'
import TranscodeLab from './TranscodeLab.vue'
import './style.css'

import '@unocss/reset/tailwind-compat.css'
import 'uno.css'

/*
 * `?lab=transcode` swaps the editor for the transcode measurement page. A query
 * flag rather than a router: the playground has exactly one app, and the lab is
 * a throwaway measurement tool, not a second product surface.
 */
const isTranscodeLab = new URLSearchParams(location.search).get('lab') === 'transcode'

const app = createApp(isTranscodeLab ? TranscodeLab : App)

app.mount('#app')
