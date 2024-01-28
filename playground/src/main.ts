import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import '@unocss/reset/tailwind-compat.css'
import 'uno.css'

const app = createApp(App)

app.mount('#app')
