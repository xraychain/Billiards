const TEXT = {
  en: {
    hit: "HIT",
    left: "L",
    right: "R",
    respot: "Respot",
    rerack: "Rerack",
    undo: "Undo",
    repeat: "Repeat",
    placeMode: "Move balls",
  },
  tr: {
    hit: "VUR",
    left: "Sol",
    right: "Sağ",
    respot: "Noktaya",
    rerack: "Yeniden diz",
    undo: "Geri al",
    repeat: "Tekrarla",
    placeMode: "Topları taşı",
  },
}

export type TextKey = keyof (typeof TEXT)["en"]

let current: keyof typeof TEXT = "en"

export function setLocale(locale: string | undefined) {
  current = locale?.toLowerCase().startsWith("tr") ? "tr" : "en"
}

export function t(key: TextKey): string {
  return TEXT[current][key]
}
