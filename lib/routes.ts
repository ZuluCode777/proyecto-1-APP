export type BusRoute = {
  id: string
  code: string
  label: string
  from: string
  to: string
  stops: string[]
  frequent: boolean
}

export const routes: BusRoute[] = [
  {
    id: "b12",
    code: "B12",
    label: "Portal Norte hacia Av. Jiménez",
    from: "Portal Norte",
    to: "Av. Jiménez",
    stops: ["Calle 100", "Héroes", "Calle 72", "Calle 45", "Marly"],
    frequent: true,
  },
  {
    id: "k43",
    code: "K43",
    label: "Portal 80 hacia Portal Sur",
    from: "Portal 80",
    to: "Portal Sur",
    stops: ["Av. Rojas", "Ricaurte", "Tercer Milenio", "Santa Isabel"],
    frequent: true,
  },
  {
    id: "f19",
    code: "F19",
    label: "Portal Suba hacia Portal Tunal",
    from: "Portal Suba",
    to: "Portal Tunal",
    stops: ["Suba Calle 100", "La Campiña", "Puente Aranda", "Restrepo"],
    frequent: false,
  },
  {
    id: "h13",
    code: "H13",
    label: "Portal Usme hacia Portal Norte",
    from: "Portal Usme",
    to: "Portal Norte",
    stops: ["Molinos", "Calle 40 Sur", "Av. Jiménez", "Calle 100"],
    frequent: true,
  },
  {
    id: "d21",
    code: "D21",
    label: "Portal Américas hacia Calle 100",
    from: "Portal Américas",
    to: "Calle 100",
    stops: ["Banderas", "Ricaurte", "Calle 26", "Calle 76"],
    frequent: false,
  },
  {
    id: "g12",
    code: "G12",
    label: "Portal Dorado hacia Portal 20 de Julio",
    from: "Portal Dorado",
    to: "Portal 20 de Julio",
    stops: ["Modelia", "Av. Jiménez", "Hospital", "Country Sur"],
    frequent: false,
  },
  {
    id: "j24",
    code: "J24",
    label: "Portal Tunal hacia Calle 72",
    from: "Portal Tunal",
    to: "Calle 72",
    stops: ["Parque", "Santa Isabel", "Calle 45", "Calle 63"],
    frequent: false,
  },
  {
    id: "c15",
    code: "C15",
    label: "Portal Sur hacia Portal Suba",
    from: "Portal Sur",
    to: "Portal Suba",
    stops: ["Perdomo", "Ricaurte", "Av. Rojas", "Suba"],
    frequent: false,
  },
]

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

export function searchRoutes(query: string): BusRoute[] {
  const q = normalize(query)
  if (!q) return routes
  return routes.filter((route) => {
    const haystack = normalize(
      [route.code, route.label, route.from, route.to, ...route.stops].join(" "),
    )
    return q.split(/\s+/).some((word) => word.length > 1 && haystack.includes(word))
  })
}

export function frequentRoutes(): BusRoute[] {
  return routes.filter((route) => route.frequent)
}
