# Generate App Store Ready Screenshots
## Custom background, device frames & localized promo text.

Preparing screenshots for App Store Connect is tedious, especially if your app:
- Supports multiple languages
- Requires separate screenshots for iPhone and iPad
- Needs custom promotional text, device frames, and gradient backgrounds

For example, my app supports 14 languages and needs 4 screenshots each for iPhone and iPad, so that's 112 screenshots before I’ve styled them.

This tool automates the process of:
- Applying device frames to your raw screenshots
- Adding custom localized promo text above each image
- Overlaying everything on a whatever background you like
- Splitting the final composite into correctly sized, App Store–ready screenshot files

Instead of manually editing hundreds of images, you can batch-generate all your screenshots in a consistent style ready for upload, in sizes ready for the App Store.

<img width="4480" height="2520" alt="process" src="https://github.com/user-attachments/assets/bb96b181-0d20-43da-8f7b-da7d886987b1" />

## How it works
The ```00_input``` directory contains your raw input files and assets, so this is where you can customize the localized text, background gradient etc.

When you run ```npm run build```, the code will:
1. Add device frames to the screenshots, per settings in ```01_input_framed/settings.ts```
2. Combine the framed screenshots into a single image over the background image, per settings in ```02_input_combined/settings.ts```
3. Split the combined screenshots into the exact resolution required by the App Store, per settings in ```03_splitter/settings.ts```

The output will be in the ```output``` directory, and will be organized by device type (iPad, iPhone) and screen dimensions per the DEFAULT_DEVICE_CONFIGS setting in ```03_splitter/splitter.ts```

## Usage
1. Create your own background gradient and replace ```00_input/background/bg.png```. 

You can use whatever background you like, personally I like [https://photogradient.com/](https://photogradient.com/) with these settings:
- __Gradient__: Soft Bezier 
- __Warp Shape__: Flat
- __Dimensions__: W: 2580 H: 1398
- __Warp__: Any
- __Warp Size__: Any
- __Noise__: None

<img width="980" height="613" alt="photogradient" src="https://github.com/user-attachments/assets/ba332f8f-a8f7-4a40-8632-94e617db985b" />

You can hover over the gradient to move the colours around, or click the + and - buttons to add or remove colours.

2. Customize the localized text you want above the screenshots:
```
  ├── 00_input/
  │   ├── translations/
  │   │   ├── ar.json              # Arabic translations
  │   │   ├── en.json              # English translations
  │   │   └── ...                  # Other language translation files
  ```
3. Use the iOS simulator to take screenshots.
4. Copy your screenshots into the ipad/iphone slots for each language:
```
  ├── 00_input/
  │   ├── screenshots/
  │   │   ├── ipad/
  │   │   │   ├── ar/              # Arabic screenshots
  │   │   │   │   ├── slot_1.png   # Screenshot slot 1
  │   │   │   │   ├── slot_2.png   # Screenshot slot 2
  │   │   │   │   ├── slot_3.png   # Screenshot slot 3
  │   │   │   │   └── slot_4.png   # Screenshot slot 4
  │   │   │   ├── en/              # English screenshots
  │   │   │   │   ├── slot_1.png   # Screenshot slot 1
  │   │   │   │   ├── slot_2.png   # Screenshot slot 2
  │   │   │   │   ├── slot_3.png   # Screenshot slot 3
  │   │   │   │   └── slot_4.png   # Screenshot slot 4
  │   │   │   └── ...              # Other language folders
  │   │   └── iphone/
  │   │       ├── ar/              # Arabic screenshots
  │   │       ├── en/              # English screenshots
  │   │       └── ...              # Other language folders
  ```
5. Generate the App Store ready screenshots
  - To install dependencies, run ```npm run install``` (only needs to be done once)
  - To build all, run ```npm run build``` (builds all locales)
  - To build one locale, for example english, run ```npm run build:locale en```

## Directory Structure
```
├── README.md                        # Project documentation
├── 00_input/                        # Raw input files and assets
├── 01_input_framed/                 # First processing stage - FRAMING
│   ├── framer.ts                    # Script to add device frames
│   └── settings.ts                  # Frame positioning configuration
├── 02_input_combined/               # Second processing stage - COMBINING
│   ├── combiner.ts                  # Script to overlay screenshots on backgrounds
│   └── settings.ts                  # Combining configuration
├── 03_splitter/                     # Final processing stage - SPLITTING
│   ├── splitter.ts                  # Script to create final App Store format
│   └── cleanup.ts                   # Cleanup utilities
└── output/                          # Final generated screenshots
    ├── ipad 13 inch (2752x2064)/    # iPad Pro 13-inch screenshots
    ├── iphone 6.5 inch (1242x2688)/ # iPhone 6.5-inch screenshots
    └── iphone 6.9 inch (1320x2868)/ # iPhone 6.9-inch screenshots
```

## Credits
- [https://photogradient.com/](https://photogradient.com/) for the background gradient generator

## License
This is free and open source code. I hope it saves you time!
