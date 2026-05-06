import os
import re

directories = [
    'c:/Users/Jaydev Mahato/OneDrive/Desktop/JDLX_MOBILE/frontend/src/pages/admin/',
    'c:/Users/Jaydev Mahato/OneDrive/Desktop/JDLX_MOBILE/frontend/src/pages/user/'
]

# Patterns to replace - adding hooks, utils, and generic assets
replacements = {
    "from '../config'": "from '../../config'",
    "from '../store/useStore'": "from '../../store/useStore'",
    "from '../components/": "from '../../components/",
    "from '../assets/": "from '../../assets/",
    "from '../hooks/": "from '../../hooks/",
    "from '../utils/": "from '../../utils/",
    "import( '../config'": "import( '../../config'", 
    "import( '../store/useStore'": "import( '../../store/useStore'",
    "import( '../hooks/": "import( '../../hooks/",
    "import( '../utils/": "import( '../../utils/"
}

for directory in directories:
    if not os.path.exists(directory):
        print(f"Directory not found: {directory}")
        continue
        
    for filename in os.listdir(directory):
        if filename.endswith('.jsx'):
            filepath = os.path.join(directory, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = content
            for old, new in replacements.items():
                new_content = new_content.replace(old, new)
            
            if new_content != content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Patched: {filename}")

print("Import patching complete.")
