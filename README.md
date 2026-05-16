# Fetch! Helper
This GreaseMonkey script enhances the Fetch! game on Neopets by providing visual cues for recommended moves (and for the autoplayer, automated gameplay assistance), helping players navigate the maze and locate the item more easily.
**Note:** Should be functional now. Please report any problems encountered under Issues.
## Features
* **Dynamic Compass Highlighting (for Helper):**
    * Script looks for the optimal next move using pathfinding
    * Recommended compass direction will be highlighted magenta
    * Highlight updates each turn as the player moves through the maze
    * Different highlight colors for different contexts: (magenta = recommended direction), (yellow = exit), (green = item)
* **Automated Gameplay (for Autoplayer):**
    * Full autoplayer functionality
    * Variable delays between actions
* **Mini-Map:**
    * See the paths uncovered
## Installation
This script requires a user script manager like Tampermonkey or Greasemonkey.
1. **Install a User Script Manager:**
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Greasemonkey](https://www.greasespot.net/)
2. **Create a New User Script:**
   - Click on the Greasemonkey/Tampermonkey icon in your browser's toolbar
   - Select "Create a new script..." (or "New script")
3. **Paste the Script:**
   - Delete any existing code in the new script editor
   - Copy the entire code from the `Fetch! Helper` script and paste it into the editor
4. **Save the Script:**
   - Save the script (usually `Ctrl+S` or `File > Save`)
## Usage
1. **Navigate to the Neopets Fetch! game page**
2. **The script will automatically run and apply highlights to the compass**
3. **Observe the magenta outline on the compass to guide your next move**
4. **When navigating the maze, the recommended direction will be highlighted magenta**
5. **Use WASD or Arrow Keys to move without clicking the compass**
6. **For automated play:** The script will automatically make moves (please adjust delays as you see fit)
## Configuration
The script includes configurable delay ranges to make automated gameplay less predictable:
- **Move delay:** 1000-1800ms
- **Restart delay:** 2000ms
- **Enter maze delay:** 1000ms
- **New game delay:** 1000ms
## Compatibility
* **Browser:** Compatible with modern web browsers (Chrome, Firefox, Edge, Opera) using a user script manager
* **Game:** Designed specifically for the Neopets Fetch! maze game
## Contributing
Contributions are welcome! If you have suggestions for improvements, bug fixes, or new features, feel free to open an issue or submit a pull request.
## License
This project is open-source and available under the MIT License.

**Disclaimer:** "Neopets" is a registered trademark of Neopets, Inc. This script is an unofficial fan-made helper and is not affiliated with or endorsed by Neopets, Inc.
