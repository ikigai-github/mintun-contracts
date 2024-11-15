import { CollectionInfo } from './collection-info';
import { IMAGE_PURPOSE } from './image';

export const TEST_COLLECTION_INFO: CollectionInfo = {
  name: 'Test Collection',
  artist: 'Arty McArtface',
  nsfw: true,
  project: 'Mystical Mystic',
  description:
    'Sometimes when the sun arrives in the backyard and an iguana ' +
    'perches upon your forseen consequences you drive to be the ' +
    'youngest forest in the hold of great hearts located underneath ' +
    'your smile and beneath their eyes.  Laden with the glory of the ' +
    'guilty you dance the song of night swept dreams until that ' +
    'undefinable clash of heart and soul sunders you from the whole.',
  images: [
    {
      src: 'https://picsum.photos/200/200',
      purpose: IMAGE_PURPOSE.Thumbnail,
      dimension: { width: 200, height: 200 },
      mediaType: 'image/jpeg',
    },
  ],
  links: { website: 'https://www.website.com', x: 'https://www.x.com', instagram: 'https://www.instagram.com' },
};
