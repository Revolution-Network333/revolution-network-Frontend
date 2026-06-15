import shutil

FILE = 'index.html'
shutil.copy2(FILE, FILE + '.bak_i18n_bw2')

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

results = []

# ══════════════════════════════════════════════════════════════
# 1. REMPLACEMENTS HTML — ancres très spécifiques
# ══════════════════════════════════════════════════════════════
html_replacements = [
    # Section header (unique car seul dans le fichier)
    ('// recharge & abonnements',
     "${t('shop.bw.section')}"),
    # Desc section
    ("Achète de la bande passante en une fois ou souscris un plan mensuel — le prix s'adapte à ta sélection.",
     "${t('shop.bw.intro')}"),
    # Tag achat ponctuel
    ('// achat ponctuel',
     "${t('shop.bw.one_time_tag')}"),
    # Titre carte recharge
    ('Recharge de bande passante',
     "${t('shop.bw.title')}"),
    # Sous-titre carte recharge
    ('Paiement unique · Crédité immédiatement après confirmation Stripe.',
     "${t('shop.bw.subtitle')}"),
    # Onglets — contexte élargi pour être sûr
    ("rn-bw-tab rn-bw-tab-on\" onclick=\"rnBwSwitch('palier',this)\">Paliers<",
     "rn-bw-tab rn-bw-tab-on\" onclick=\"rnBwSwitch('palier',this)\">${t('shop.bw.tab_paliers')}<"),
    ("rn-bw-tab\" onclick=\"rnBwSwitch('slider',this)\">Curseur<",
     "rn-bw-tab\" onclick=\"rnBwSwitch('slider',this)\">${t('shop.bw.tab_curseur')}<"),
    ("rn-bw-tab\" onclick=\"rnBwSwitch('custom',this)\">Libre<",
     "rn-bw-tab\" onclick=\"rnBwSwitch('custom',this)\">${t('shop.bw.tab_libre')}<"),
    # Label volume custom — contexte élargi
    ("white-space:nowrap;\">Volume (GB)<",
     "white-space:nowrap;\">${t('shop.bw.custom_label')}<"),
    # Preview recharge — contexte élargi pour différencier du JS
    ("margin-bottom:.15rem;\">volume sélectionné<",
     "margin-bottom:.15rem;\">${t('shop.bw.selected_vol')}<"),
    # "paiement unique" — contexte élargi (display:block;text-align:right dans la recharge)
    ("display:block;text-align:right;\">paiement unique<",
     "display:block;text-align:right;\">${t('shop.bw.one_time_lbl')}<"),
    # Tag plan mensuel
    ('// plan mensuel',
     "${t('shop.sub.tag')}"),
    # Titre carte abonnement — contexte élargi
    ("font-size:.85rem;margin-bottom:.2rem;\">Abonnement mensuel<",
     "font-size:.85rem;margin-bottom:.2rem;\">${t('shop.sub.title')}<"),
    # Sous-titre carte abonnement
    ("GB + crédits renouvelés chaque mois · Annulable à tout moment.",
     "${t('shop.sub.subtitle')}"),
    # Preview abonnement — "plan sélectionné" avec contexte unique
    ("margin-bottom:.15rem;\">plan sélectionné<",
     "margin-bottom:.15rem;\">${t('shop.sub.selected')}<"),
    # GB/mois — contexte unique (margin-left:3px dans le panel sub)
    ("margin-left:3px;font-family:'DM Sans',sans-serif;\">GB/mois<",
     "margin-left:3px;font-family:'DM Sans',sans-serif;\">${t('shop.sub.gb_month')}<"),
    # /mois — contexte unique (display:block;text-align:right dans le sub)
    ("display:block;text-align:right;\">/mois<",
     "display:block;text-align:right;\">${t('shop.sub.per_month')}<"),
]

for old, new in html_replacements:
    if old in content:
        content = content.replace(old, new, 1)
        results.append(f'OK HTML — {old[:50]}')
    else:
        results.append(f'SKIP — {old[:50]}')

# ══════════════════════════════════════════════════════════════
# 2. STRINGS JS dans l'IIFE (ces remplacements étaient corrects)
# ══════════════════════════════════════════════════════════════
js_replacements = [
    # renderSubs — "crédits/mois" hardcodé dans template HTML string
    ("'+sub.cr.toLocaleString('fr-FR')+' cr\\u00e9dits/mois",
     "'+sub.cr.toLocaleString('fr-FR')+' '+t('shop.sub.credits_month')"),
    # updSub — bouton S'abonner
    ("'S\\u2019abonner \\u2014 '",
     "t('shop.sub.btn_prefix')+' '"),
    # updCr — bouton Acheter
    ("'Acheter '+gb+' GB \\u2014 '",
     "t('shop.bw.btn_buy')+' '+gb+' GB \\u2014 '"),
    # Erreur connexion achat
    ("'Connectez-vous pour acheter.'",
     "t('shop.bw.err_login')"),
    # Erreur connexion abonnement
    ("'Connectez-vous pour vous abonner.'",
     "t('shop.sub.err_login')"),
    # Redirection
    ("btn.textContent='Redirection...';",
     "btn.textContent=t('shop.redirecting');"),
    # Erreur générique achat
    ("'Erreur : '+(e.message||'paiement impossible')",
     "t('shop.err_prefix')+(e.message||t('shop.bw.err_pay'))"),
    # Erreur générique abonnement
    ("'Erreur : '+(e.message||'abonnement impossible')",
     "t('shop.err_prefix')+(e.message||t('shop.sub.err_sub'))"),
]

for old, new in js_replacements:
    if old in content:
        content = content.replace(old, new, 1)
        results.append(f'OK JS  — {old[:50]}')
    else:
        results.append(f'SKIP JS — {old[:50]}')

# ══════════════════════════════════════════════════════════════
# 3. CLÉS i18n FR / EN / ES
# ══════════════════════════════════════════════════════════════
NEW_KEYS_FR = """
                'shop.bw.section': '// Recharge & Abonnements',
                'shop.bw.intro': "Ach\\u00e8te de la bande passante en une fois ou souscris un plan mensuel \\u2014 le prix s\\'adapte \\u00e0 ta s\\u00e9lection.",
                'shop.bw.one_time_tag': '// Achat ponctuel',
                'shop.bw.title': 'Recharge de bande passante',
                'shop.bw.subtitle': 'Paiement unique \\u00b7 Cr\\u00e9dit\\u00e9 imm\\u00e9diatement apr\\u00e8s confirmation Stripe.',
                'shop.bw.tab_paliers': 'Paliers',
                'shop.bw.tab_curseur': 'Curseur',
                'shop.bw.tab_libre': 'Libre',
                'shop.bw.custom_label': 'Volume (GB)',
                'shop.bw.selected_vol': 'volume s\\u00e9lectionn\\u00e9',
                'shop.bw.one_time_lbl': 'paiement unique',
                'shop.bw.btn_buy': 'Acheter',
                'shop.bw.err_login': 'Connectez-vous pour acheter.',
                'shop.bw.err_pay': 'paiement impossible',
                'shop.sub.tag': '// Plan mensuel',
                'shop.sub.title': 'Abonnement mensuel',
                'shop.sub.subtitle': 'GB + cr\\u00e9dits renouvel\\u00e9s chaque mois \\u00b7 Annulable \\u00e0 tout moment.',
                'shop.sub.selected': 'plan s\\u00e9lectionn\\u00e9',
                'shop.sub.gb_month': 'GB/mois',
                'shop.sub.per_month': '/mois',
                'shop.sub.credits_month': 'cr\\u00e9dits/mois',
                'shop.sub.btn_prefix': "S\\'abonner \\u2014",
                'shop.sub.err_login': 'Connectez-vous pour vous abonner.',
                'shop.sub.err_sub': 'abonnement impossible',
                'shop.redirecting': 'Redirection...',
                'shop.err_prefix': 'Erreur\\u00a0: ',"""

NEW_KEYS_EN = """
                'shop.bw.section': '// Bandwidth & Subscriptions',
                'shop.bw.intro': 'Buy bandwidth once or subscribe to a monthly plan \\u2014 price adjusts to your selection.',
                'shop.bw.one_time_tag': '// One-time purchase',
                'shop.bw.title': 'Bandwidth Top-up',
                'shop.bw.subtitle': 'One-time payment \\u00b7 Credited instantly after Stripe confirmation.',
                'shop.bw.tab_paliers': 'Tiers',
                'shop.bw.tab_curseur': 'Slider',
                'shop.bw.tab_libre': 'Custom',
                'shop.bw.custom_label': 'Volume (GB)',
                'shop.bw.selected_vol': 'selected volume',
                'shop.bw.one_time_lbl': 'one-time payment',
                'shop.bw.btn_buy': 'Buy',
                'shop.bw.err_login': 'Please log in to purchase.',
                'shop.bw.err_pay': 'payment failed',
                'shop.sub.tag': '// Monthly plan',
                'shop.sub.title': 'Monthly Subscription',
                'shop.sub.subtitle': 'GB + credits renewed each month \\u00b7 Cancel anytime.',
                'shop.sub.selected': 'selected plan',
                'shop.sub.gb_month': 'GB/month',
                'shop.sub.per_month': '/month',
                'shop.sub.credits_month': 'credits/month',
                'shop.sub.btn_prefix': 'Subscribe \\u2014',
                'shop.sub.err_login': 'Please log in to subscribe.',
                'shop.sub.err_sub': 'subscription failed',
                'shop.redirecting': 'Redirecting...',
                'shop.err_prefix': 'Error: ',"""

NEW_KEYS_ES = """
                'shop.bw.section': '// Ancho de banda & Suscripciones',
                'shop.bw.intro': 'Compra ancho de banda una vez o suscr\\u00edbete a un plan mensual \\u2014 el precio se adapta a tu selecci\\u00f3n.',
                'shop.bw.one_time_tag': '// Compra \\u00fanica',
                'shop.bw.title': 'Recarga de ancho de banda',
                'shop.bw.subtitle': 'Pago \\u00fanico \\u00b7 Acreditado inmediatamente tras confirmaci\\u00f3n de Stripe.',
                'shop.bw.tab_paliers': 'Niveles',
                'shop.bw.tab_curseur': 'Deslizador',
                'shop.bw.tab_libre': 'Libre',
                'shop.bw.custom_label': 'Volumen (GB)',
                'shop.bw.selected_vol': 'volumen seleccionado',
                'shop.bw.one_time_lbl': 'pago \\u00fanico',
                'shop.bw.btn_buy': 'Comprar',
                'shop.bw.err_login': 'Inicia sesi\\u00f3n para comprar.',
                'shop.bw.err_pay': 'pago fallido',
                'shop.sub.tag': '// Plan mensual',
                'shop.sub.title': 'Suscripci\\u00f3n mensual',
                'shop.sub.subtitle': 'GB + cr\\u00e9ditos renovados cada mes \\u00b7 Cancelable en cualquier momento.',
                'shop.sub.selected': 'plan seleccionado',
                'shop.sub.gb_month': 'GB/mes',
                'shop.sub.per_month': '/mes',
                'shop.sub.credits_month': 'cr\\u00e9ditos/mes',
                'shop.sub.btn_prefix': 'Suscribirse \\u2014',
                'shop.sub.err_login': 'Inicia sesi\\u00f3n para suscribirte.',
                'shop.sub.err_sub': 'suscripci\\u00f3n fallida',
                'shop.redirecting': 'Redirigiendo...',
                'shop.err_prefix': 'Error: ',"""

ANCHOR_FR = "'shop.node.subtitle': '150,00 \u20ac \u2014 paiement unique',"
ANCHOR_EN = "'shop.node.subtitle': '\u20ac150.00 \u2014 one-time payment',"
ANCHOR_ES = "'shop.node.subtitle': '150,00 \u20ac \u2014 pago \u00fanico',"

for anchor, keys, lang in [
    (ANCHOR_FR, NEW_KEYS_FR, 'FR'),
    (ANCHOR_EN, NEW_KEYS_EN, 'EN'),
    (ANCHOR_ES, NEW_KEYS_ES, 'ES'),
]:
    if anchor in content:
        content = content.replace(anchor, anchor + keys, 1)
        results.append(f'OK i18n {lang}')
    else:
        results.append(f'ERREUR ancre i18n {lang}')

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n'.join(results))
print('\nSi tout OK:')
print('  git add index.html && git commit -m "feat: i18n panels bw+sub v2" && git push')
