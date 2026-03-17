import { ref } from 'vue'

export const darkMode = ref(false)

export function initializeTheme() {
  darkMode.value = localStorage.theme === 'dark'
  document.documentElement.classList.toggle('dark', darkMode.value)
}
