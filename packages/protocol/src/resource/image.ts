export function loadImage(data: ArrayBuffer | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject

    if (typeof data === 'string') {
      img.src = data
    }
    else {
      const blob = new Blob([data])
      img.src = URL.createObjectURL(blob)
    }
  })
}
