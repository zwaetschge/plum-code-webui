package com.claudewebui.app.ui.components.dynamicui

// The three reference examples from packages/frontend/src/components/assistant/dynamic-ui/fixtures.ts,
// as JSON: A (compound interest), B (sales dashboard), C (product comparison).

/** Example compound-interest. */
const val COMPOUND_INTEREST = """
{
 "version": 1,
 "title": "Zinseszinsrechner",
 "state": {
  "start": 10000,
  "rate": 5,
  "years": 15,
  "monthly": 200
 },
 "computed": {
  "final": "fv(rate / 100 / 12, years * 12, monthly, start)",
  "paid": "start + monthly * 12 * years",
  "gain": "final - paid"
 },
 "views": {
  "growth": {
   "generate": {
    "var": "year",
    "from": "0",
    "to": "years"
   },
   "fields": {
    "year": "year",
    "capital": "round(fv(rate / 100 / 12, year * 12, monthly, start))",
    "paid": "start + monthly * 12 * year"
   }
  }
 },
 "root": {
  "type": "calculator",
  "inputs": [
   {
    "type": "slider",
    "bind": "start",
    "label": "Startkapital",
    "min": 0,
    "max": 100000,
    "step": 1000,
    "format": "currency:CHF"
   },
   {
    "type": "slider",
    "bind": "monthly",
    "label": "Monatliche Einzahlung",
    "min": 0,
    "max": 2000,
    "step": 50,
    "format": "currency:CHF"
   },
   {
    "type": "slider",
    "bind": "rate",
    "label": "Zinssatz p. a.",
    "min": 0,
    "max": 12,
    "step": 0.1,
    "format": "percent"
   },
   {
    "type": "slider",
    "bind": "years",
    "label": "Laufzeit (Jahre)",
    "min": 1,
    "max": 40,
    "step": 1,
    "format": "integer"
   }
  ],
  "outputs": [
   {
    "type": "kpi",
    "label": "Endkapital",
    "value": "final",
    "format": "currency:CHF"
   },
   {
    "type": "kpi",
    "label": "Eingezahlt",
    "value": "paid",
    "format": "currency:CHF"
   },
   {
    "type": "kpi",
    "label": "Zinsertrag",
    "value": "gain",
    "format": "currency:CHF",
    "trend": "gain",
    "hint": "{{gain / max(paid, 1) * 100|percent}} auf das eingezahlte Geld"
   }
  ],
  "chart": {
   "type": "chart",
   "kind": "area",
   "data": "growth",
   "x": "year",
   "series": [
    {
     "key": "capital",
     "label": "Kapital"
    },
    {
     "key": "paid",
     "label": "Eingezahlt"
    }
   ],
   "format": "currency:CHF"
  }
 }
}
"""

/** Example sales-dashboard. */
const val SALES_DASHBOARD = """
{
 "version": 1,
 "title": "Umsatz 2026",
 "layout": "dashboard",
 "state": {
  "region": "Alle",
  "channel": "Alle"
 },
 "data": {
  "sales": [
   {
    "month": "Jan",
    "region": "Nord",
    "channel": "Online",
    "revenue": 42000,
    "orders": 310
   },
   {
    "month": "Jan",
    "region": "Süd",
    "channel": "Filiale",
    "revenue": 38000,
    "orders": 260
   },
   {
    "month": "Feb",
    "region": "Nord",
    "channel": "Online",
    "revenue": 45500,
    "orders": 332
   },
   {
    "month": "Feb",
    "region": "Süd",
    "channel": "Filiale",
    "revenue": 36000,
    "orders": 248
   },
   {
    "month": "Mär",
    "region": "Nord",
    "channel": "Filiale",
    "revenue": 51000,
    "orders": 351
   },
   {
    "month": "Mär",
    "region": "Süd",
    "channel": "Online",
    "revenue": 40500,
    "orders": 296
   },
   {
    "month": "Apr",
    "region": "Nord",
    "channel": "Online",
    "revenue": 53800,
    "orders": 380
   },
   {
    "month": "Apr",
    "region": "Süd",
    "channel": "Online",
    "revenue": 44200,
    "orders": 318
   },
   {
    "month": "Mai",
    "region": "Nord",
    "channel": "Filiale",
    "revenue": 49900,
    "orders": 344
   },
   {
    "month": "Mai",
    "region": "Süd",
    "channel": "Filiale",
    "revenue": 47100,
    "orders": 333
   },
   {
    "month": "Jun",
    "region": "Nord",
    "channel": "Online",
    "revenue": 58300,
    "orders": 402
   },
   {
    "month": "Jun",
    "region": "Süd",
    "channel": "Online",
    "revenue": 49800,
    "orders": 351
   }
  ]
 },
 "views": {
  "filtered": {
   "from": "sales",
   "filter": "(selectedRegion == 'Alle' || region == selectedRegion) && (selectedChannel == 'Alle' || channel == selectedChannel)"
  },
  "monthly": {
   "from": "filtered",
   "groupBy": "month",
   "aggregate": {
    "revenue": {
     "field": "revenue",
     "op": "sum"
    },
    "orders": {
     "field": "orders",
     "op": "sum"
    }
   }
  }
 },
 "computed": {
  "selectedRegion": "region",
  "selectedChannel": "channel",
  "total": "sumOf('filtered', 'revenue')",
  "orders": "sumOf('filtered', 'orders')",
  "basket": "total / max(orders, 1)"
 },
 "root": {
  "type": "stack",
  "children": [
   {
    "type": "row",
    "children": [
     {
      "type": "segmented",
      "bind": "region",
      "label": "Region",
      "options": [
       {
        "value": "Alle",
        "label": "Alle"
       },
       {
        "value": "Nord",
        "label": "Nord"
       },
       {
        "value": "Süd",
        "label": "Süd"
       }
      ]
     },
     {
      "type": "select",
      "bind": "channel",
      "label": "Kanal",
      "options": [
       {
        "value": "Alle",
        "label": "Alle Kanäle"
       },
       {
        "value": "Online",
        "label": "Online"
       },
       {
        "value": "Filiale",
        "label": "Filiale"
       }
      ]
     }
    ]
   },
   {
    "type": "grid",
    "columns": 3,
    "children": [
     {
      "type": "kpi",
      "label": "Umsatz",
      "value": "total",
      "format": "currency:CHF"
     },
     {
      "type": "kpi",
      "label": "Bestellungen",
      "value": "orders",
      "format": "integer"
     },
     {
      "type": "kpi",
      "label": "Ø Warenkorb",
      "value": "basket",
      "format": "currency:CHF"
     }
    ]
   },
   {
    "type": "card",
    "title": "Umsatz pro Monat · {{region}} · {{channel}}",
    "children": [
     {
      "type": "chart",
      "kind": "bar",
      "data": "monthly",
      "x": "month",
      "series": [
       {
        "key": "revenue",
        "label": "Umsatz"
       }
      ],
      "format": "currency:CHF"
     }
    ]
   },
   {
    "type": "table",
    "data": "monthly",
    "columns": [
     {
      "key": "month",
      "label": "Monat"
     },
     {
      "key": "orders",
      "label": "Bestellungen",
      "format": "integer"
     },
     {
      "key": "revenue",
      "label": "Umsatz",
      "format": "currency:CHF"
     }
    ],
    "highlight": "revenue == maxOf('monthly', 'revenue')"
   }
  ]
 }
}
"""

/** Example product-comparison. */
const val PRODUCT_COMPARISON = """
{
 "version": 1,
 "title": "Notebooks im Vergleich",
 "state": {
  "pick": "air"
 },
 "computed": {
  "pickName": "pick == 'air' ? 'Aero 14' : pick == 'pro' ? 'Pro 16' : 'Flex 13'",
  "pickPrice": "pick == 'air' ? 1299 : pick == 'pro' ? 2499 : 899"
 },
 "root": {
  "type": "stack",
  "children": [
   {
    "type": "compare",
    "bind": "pick",
    "items": [
     {
      "id": "flex",
      "title": "Flex 13",
      "subtitle": "Leicht und günstig",
      "values": {
       "price": 899,
       "weight": 1.1,
       "battery": 12,
       "ram": 16,
       "screen": 13.3
      }
     },
     {
      "id": "air",
      "title": "Aero 14",
      "subtitle": "Ausgewogen",
      "badge": "Empfehlung",
      "values": {
       "price": 1299,
       "weight": 1.3,
       "battery": 16,
       "ram": 24,
       "screen": 14.2
      }
     },
     {
      "id": "pro",
      "title": "Pro 16",
      "subtitle": "Maximale Leistung",
      "values": {
       "price": 2499,
       "weight": 2.1,
       "battery": 14,
       "ram": 48,
       "screen": 16.2
      }
     }
    ],
    "specs": [
     {
      "key": "price",
      "label": "Preis",
      "format": "currency:CHF",
      "better": "lower"
     },
     {
      "key": "weight",
      "label": "Gewicht (kg)",
      "format": "decimal:1",
      "better": "lower"
     },
     {
      "key": "battery",
      "label": "Akku (h)",
      "format": "integer",
      "better": "higher"
     },
     {
      "key": "ram",
      "label": "Arbeitsspeicher (GB)",
      "format": "integer",
      "better": "higher"
     },
     {
      "key": "screen",
      "label": "Display (Zoll)",
      "format": "decimal:1"
     }
    ]
   },
   {
    "type": "row",
    "children": [
     {
      "type": "text",
      "text": "Auswahl: {{pickName}} für {{pickPrice|currency:CHF}}",
      "tone": "strong"
     },
     {
      "type": "button",
      "label": "Mehr zu dieser Wahl",
      "action": {
       "type": "sendMessage",
       "text": "Erzähl mir mehr über das {{pickName}} und für wen es sich lohnt."
      }
     }
    ]
   }
  ]
 }
}
"""
