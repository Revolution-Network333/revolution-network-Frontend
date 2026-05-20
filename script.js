// Attendre que le DOM soit chargé
document.addEventListener('DOMContentLoaded', function() {
  // Récupérer les éléments du DOM
  const profilePicture = document.getElementById('profilePictureDropdown');
  const profileDropdown = document.getElementById('profileDropdown');
  const changeProfilePic = document.getElementById('changeProfilePic');
  const imageScrollContainer = document.getElementById('imageScrollContainer');
  const imageScroll = document.getElementById('imageScroll');

  // Liste des images disponibles dans le dossier Avatar
  const availableImages = [
    'Avatar/21564.jpeg',
    'Avatar/532135.jpeg',
    'Avatar/5635.jpeg',
    'Avatar/645165.jpeg',
    'Avatar/Capture d\'écran 2025-12-03 234926.jpeg',
    'Avatar/Capture d\'écran 2025-12-03 235019.jpeg',
    'Avatar/create_a_retro_futuristic_cyberpunk_nft_character_in (4).jpeg',
    'Avatar/Lucid_Origin_Create_a_retrofuturistic_cyberpunk_NFT_character__0.jpeg',
    'Avatar/téléchargement (2).jpeg',
    'Avatar/téléchargement (21) (1).jpg',
    'Avatar/téléchargement (21).jpg',
    'Avatar/téléchargement (23).jpg',
    'Avatar/téléchargement (24).jpg',
    'Avatar/téléchargement (30).jpg',
    'Avatar/téléchargement (35).jpg'
  ];

  // Afficher le menu déroulant au clic sur la photo de profil
  profilePicture.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('show');
  });

  // Fermer le menu déroulant si on clique ailleurs
  document.addEventListener('click', () => {
    profileDropdown.classList.remove('show');
    imageScrollContainer.classList.remove('show');
  });

  // Empêcher la fermeture du menu si on clique dessus
  profileDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Afficher la barre roulante au clic sur "Changer la photo de profil"
  changeProfilePic.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Vider le conteneur avant d'ajouter les images
    imageScroll.innerHTML = '';

    // Ajouter chaque image disponible
    availableImages.forEach((imagePath) => {
      const img = document.createElement('img');
      img.src = imagePath;
      img.alt = 'Aperçu photo de profil';
      img.addEventListener('click', () => {
        // Changer la photo de profil principale
        profilePicture.src = imagePath;
        // Fermer la barre roulante
        imageScrollContainer.classList.remove('show');
        profileDropdown.classList.remove('show');
      });
      imageScroll.appendChild(img);
    });

    // Afficher la barre roulante
    imageScrollContainer.classList.add('show');
    profileDropdown.classList.remove('show');
  });
});