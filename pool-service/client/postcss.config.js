// Right-to-left layouts for Arabic (GPF item 5): mirrored copies of the layout rules under
// [dir="rtl"], which the app sets on <html> when the language is written right to left.
import rtlcss from 'postcss-rtlcss';

export default {
  plugins: [rtlcss()],
};
