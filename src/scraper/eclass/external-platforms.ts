export const EXTERNAL_PLATFORMS = {
  // LTI Link href patterns that specify an external tool in Moodle/eClass
  LTI_HREF: 'mod/lti/view.php',

  // CSS classes found on the link elements that trigger an LTI launch
  LTI_LINK_CLASSES: [
    'aalink stretched-link',
    'courseindex-link text-truncate',
    'autolink',
  ],

  // CSS classes on the parent container (useful if link class isn't enough)
  LTI_CONTAINER_CLASSES: ['modtype_lti'],

  // Text heuristics to identify specific platforms from link text or URL
  KEYWORDS: {
    CENGAGE: ['cengage', 'webassign', 'mindtap'],
    CROWDMARK: ['crowdmark'],
  },
};

export const OTHER_PLATFORMS = {
  // Add more external platform patterns here in the future
};
