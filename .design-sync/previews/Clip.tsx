import { Clip } from 'myest8-design-system';

const text =
  'The kitchen tap has been dripping for a week and now runs constantly even when fully closed; water is collecting in the cupboard under the sink and the base board has started to swell.';

export const OneLine = () => (
  <div style={{ maxWidth: 320, fontSize: 14 }}>
    <Clip>{text}</Clip>
  </div>
);

export const TwoLines = () => (
  <div style={{ maxWidth: 320, fontSize: 14 }}>
    <Clip lines={2}>{text}</Clip>
  </div>
);

export const ThreeLines = () => (
  <div style={{ maxWidth: 320, fontSize: 14 }}>
    <Clip lines={3}>{text}</Clip>
  </div>
);
