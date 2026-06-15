import shutil, re

FILE = 'index.html'
shutil.copy2(FILE, FILE + '.bak_i18n_bw')

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

results = []

# ══════════════════════════════════════════════════════════════
# 1. REMPLACEMENTS HTML — strings hardcodées → t()
# ══════════════════════════════════════════════════════════════
html_replacements = [
    # Section header
    ('// recharge &amp; abonnements',
     "${t('shop.bw.section')}"),
    # On remplace aussi la version non-encodée
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
    # Onglets
    ('>Paliers<',  ">${t('shop.bw.tab_paliers')}<"),
    ('>Curseur<',  ">${t('shop.bw.tab_curseur')}<"),
    ('>Libre<',    ">${t('shop.bw.tab_libre')}<"),
    # Label volume custom
    ('>Volume (GB)<',  ">${t('shop.bw.custom_label')}<"),
    # Preview recharge
    ('>volume sélectionné<', ">${t('shop.bw.selected_vol')}<"),
    ('>paiement unique<',    ">${t('shop.bw.one_time_lbl')}<"),
    # Tag plan mensuel
    ('// plan mensuel',      "${t('shop.sub.tag')}"),
    # Titre carte abonnement
    ('>Abonnement mensuel<', ">${t('shop.sub.title')}<"),
    # Sous-titre carte abonnement
    ("GB + crédits renouvelés chaque mois · Annulable à tout moment.",
     "${t('shop.sub.subtitle')}"),
    # Preview abonnement
    ('>plan sélectionné<',   ">${t('shop.sub.selected')}<"),
    ('>GB/mois<',            ">${t('shop.sub.gb_month')}<"),
    ('>/mois<',              ">${t('shop.sub.per_month')}<"),
]

for old, new in html_replacements:
    if old in content:
        content = content.replace(old, new, 1)
        results.append(f'OK HTML — {old[:40]}')
    else:
        results.append(f'SKIP (non trouvé) — {old[:40]}')

# ══════════════════════════════════════════════════════════════
# 2. STRINGS JS dans l'IIFE
# ══════════════════════════════════════════════════════════════
js_replacements = [
    # renderSubs — "crédits/mois" hardcodé
    ("'+sub.cr.toLocaleString('fr-FR')+' cr\\u00e9dits/mois",
     "'+sub.cr.toLocaleString('fr-FR')+' '+t('shop.sub.credits_month')"),
    # updSub — bouton
    ("'S\\u2019abonner \\u2014 '",
     "t('shop.sub.btn_prefix')+' '"),
    # updCr — bouton "Acheter X GB"
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
        results.append(f'OK JS  — {old[:40]}')
    else:
        results.append(f'SKIP JS (non trouvé) — {old[:40]}')

# ══════════════════════════════════════════════════════════════
# 3. CLÉS i18n — injection dans les 3 blocs (FR / EN / ES)
# ══════════════════════════════════════════════════════════════

NEW_KEYS_FR = """
                'shop.bw.section': '// Recharge & Abonnements',
                'shop.bw.intro': "Achète de la bande passante en une fois ou souscris un plan mensuel — le prix s'adapte à ta sélection.",
                'shop.bw.one_time_tag': '// Achat ponctuel',
                'shop.bw.title': 'Recharge de bande passante',
                'shop.bw.subtitle': 'Paiement unique · Crédité immédiatement après confirmation Stripe.',
                'shop.bw.tab_paliers': 'Paliers',
                'shop.bw.tab_curseur': 'Curseur',
                'shop.bw.tab_libre': 'Libre',
                'shop.bw.custom_label': 'Volume (GB)',
                'shop.bw.selected_vol': 'volume sélectionné',
                'shop.bw.one_time_lbl': 'paiement unique',
                'shop.bw.btn_buy': 'Acheter',
                'shop.bw.err_login': 'Connectez-vous pour acheter.',
                'shop.bw.err_pay': 'paiement impossible',
                'shop.sub.tag': '// Plan mensuel',
                'shop.sub.title': 'Abonnement mensuel',
                'shop.sub.subtitle': 'GB + crédits renouvelés chaque mois · Annulable à tout moment.',
                'shop.sub.selected': 'plan sélectionné',
                'shop.sub.gb_month': 'GB/mois',
                'shop.sub.per_month': '/mois',
                'shop.sub.credits_month': 'crédits/mois',
                'shop.sub.btn_prefix': "S'abonner —",
                'shop.sub.err_login': 'Connectez-vous pour vous abonner.',
                'shop.sub.err_sub': 'abonnement impossible',
                'shop.redirecting': 'Redirection...',
                'shop.err_prefix': 'Erreur : ',"""

NEW_KEYS_EN = """
                'shop.bw.section': '// Bandwidth & Subscriptions',
                'shop.bw.intro': 'Buy bandwidth once or subscribe to a monthly plan — price adjusts to your selection.',
                'shop.bw.one_time_tag': '// One-time purchase',
                'shop.bw.title': 'Bandwidth Top-up',
                'shop.bw.subtitle': 'One-time payment · Credited instantly after Stripe confirmation.',
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
                'shop.sub.subtitle': 'GB + credits renewed each month · Cancel anytime.',
                'shop.sub.selected': 'selected plan',
                'shop.sub.gb_month': 'GB/month',
                'shop.sub.per_month': '/month',
                'shop.sub.credits_month': 'credits/month',
                'shop.sub.btn_prefix': 'Subscribe —',
                'shop.sub.err_login': 'Please log in to subscribe.',
                'shop.sub.err_sub': 'subscription failed',
                'shop.redirecting': 'Redirecting...',
                'shop.err_prefix': 'Error: ',"""

NEW_KEYS_ES = """
                'shop.bw.section': '// Ancho de banda & Suscripciones',
                'shop.bw.intro': 'Compra ancho de banda una vez o suscríbete a un plan mensual — el precio se adapta a tu selección.',
                'shop.bw.one_time_tag': '// Compra única',
                'shop.bw.title': 'Recarga de ancho de banda',
                'shop.bw.subtitle': 'Pago único · Acreditado inmediatamente tras confirmación de Stripe.',
                'shop.bw.tab_paliers': 'Niveles',
                'shop.bw.tab_curseur': 'Deslizador',
                'shop.bw.tab_libre': 'Libre',
                'shop.bw.custom_label': 'Volumen (GB)',
                'shop.bw.selected_vol': 'volumen seleccionado',
                'shop.bw.one_time_lbl': 'pago único',
                'shop.bw.btn_buy': 'Comprar',
                'shop.bw.err_login': 'Inicia sesión para comprar.',
                'shop.bw.err_pay': 'pago fallido',
                'shop.sub.tag': '// Plan mensual',
                'shop.sub.title': 'Suscripción mensual',
                'shop.sub.subtitle': 'GB + créditos renovados cada mes · Cancelable en cualquier momento.',
                'shop.sub.selected': 'plan seleccionado',
                'shop.sub.gb_month': 'GB/mes',
                'shop.sub.per_month': '/mes',
                'shop.sub.credits_month': 'créditos/mes',
                'shop.sub.btn_prefix': 'Suscribirse —',
                'shop.sub.err_login': 'Inicia sesión para suscribirte.',
                'shop.sub.err_sub': 'suscripción fallida',
                'shop.redirecting': 'Redirigiendo...',
                'shop.err_prefix': 'Error: ',"""

# Ancres i18n (clés déjà existantes ajoutées précédemment)
ANCHOR_FR = "'shop.node.subtitle': '150,00 € — paiement unique',"
ANCHOR_EN = "'shop.node.subtitle': '€150.00 — one-time payment',"
ANCHOR_ES = "'shop.node.subtitle': '€150.00 — pago único',"

for anchor, keys, lang in [
    (ANCHOR_FR, NEW_KEYS_FR, 'FR'),
    (ANCHOR_EN, NEW_KEYS_EN, 'EN'),
    (ANCHOR_ES, NEW_KEYS_ES, 'ES'),
]:
    if anchor in content:
        content = content.replace(anchor, anchor + keys, 1)
        results.append(f'OK i18n {lang}')
    else:
        results.append(f'ERREUR ancre i18n {lang} non trouvée')

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n'.join(results))
print('\nSi tout OK:')
print('  git add index.html && git commit -m "feat: i18n panels bw+sub" && git push')
