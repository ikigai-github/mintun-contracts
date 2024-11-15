/// Image purpose are hints at how the creator inteded the image to be used
export const IMAGE_PURPOSE = {
  Thumbnail: 'Thumbnail',
  Banner: 'Banner',
  Brand: 'Brand',
  Gallery: 'Gallery',
  General: 'General',
} as const;

export type ImagePurpose = keyof typeof IMAGE_PURPOSE;

/// Width height of an image in pixels
export type ImageDimension = {
  width: number;
  height: number;
};
