try {
  if (localStorage.getItem('firewatch_theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
