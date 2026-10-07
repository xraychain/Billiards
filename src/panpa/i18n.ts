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
    safety: "Safety",
    pushOut: "Push out",
    callBall: "Tap the ball to call",
    callPocket: "Tap the pocket",
    ballInHand: "Ball in hand: drag the white",
    kitchen: "Ball in hand behind the head string",
    shoot: "Shoot",
    pass: "Pass",
    accept: "Accept table",
    inHandKitchen: "Ball in hand (kitchen)",
    rerackBreak: "Re-rack, I break",
    rerackOffenderBreaks: "Re-rack, they break",
    rebreak: "Break again",
    spotEight: "Spot the 8",
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
    safety: "Güvenlik",
    pushOut: "Push-out",
    callBall: "Vuracağın topa dokun",
    callPocket: "Cebe dokun",
    ballInHand: "El topu: beyazı sürükle",
    kitchen: "El topu: baş çizgisinin gerisine koy",
    shoot: "Ben atayım",
    pass: "Rakip atsın",
    accept: "Masayı kabul et",
    inHandKitchen: "El topu (baş bölgesi)",
    rerackBreak: "Yeniden diz, ben açayım",
    rerackOffenderBreaks: "Yeniden diz, o açsın",
    rebreak: "Yeniden aç",
    spotEight: "8'i noktaya koy",
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
