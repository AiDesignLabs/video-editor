import { createApp } from 'vue'
import PlaygroundRouter from './PlaygroundRouter.vue'
import './style.css'

import '@unocss/reset/tailwind-compat.css'
import 'uno.css'

const app = createApp(PlaygroundRouter)

app.mount('#app')
