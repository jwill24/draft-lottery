import sys
import string
from numpy.random import choice
import matplotlib.pyplot as plt
from time import time
import random
import numpy as np
import pandas
from collections import Counter
from keyboard import wait

input_file = sys.argv[1]
skip_animation = sys.argv[2] == '--no_anim' if len(sys.argv) > 2 else False

experiments = 100000

with open(input_file, 'r') as f:
    team_names = [line.strip() for line in f]
    team_names.reverse()

# 2021 lottery odds
LOTTO_BALLS = {
    0: 30,
    1: 25,
    2: 16,
    3: 14,
    4: 10,
    5: 5,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
}

def plot_bar_from_counter(counter, ax=None):
    if ax is None:
        fig = plt.figure()
        ax = fig.add_subplot(111)
    counter_sorted = sorted(counter.items(), reverse=True, key=lambda x: x[1])
    frequencies = [ 100*v/float(experiments) for k,v in counter_sorted ]
    names = [k for k,v in counter_sorted]
    x_coordinates = np.arange(len(counter_sorted))
    ax.bar(x_coordinates, frequencies, align='center')
    ax.xaxis.set_major_locator(plt.FixedLocator(x_coordinates))
    ax.xaxis.set_major_formatter(plt.FixedFormatter(names))
    return ax

# Test the distribution
def plot_distribution():
    winner = []
    for i in range(experiments):
        draw = choice(list(LOTTO_BALLS.keys()), 1, p=[LOTTO_BALLS[c] / float(100) for c in LOTTO_BALLS])[0]
        winner.append( team_names[draw] )

    counts = Counter(winner)
    plot_bar_from_counter(counts)
    plt.xticks(rotation=90)
    plt.show()




# Print some gibberish to make it look like the program is thinking really hard
def print_gibberish(time_to_run, str_len=50):
    start = time()
    while True:
        sys.stdout.write('\r')
        if time()-start > time_to_run:
            sys.stdout.write('  '*(str_len))
            return
        else:
            sys.stdout.write(''.join(random.choice(string.ascii_uppercase) for x in range(str_len)))


# Run the drawing, removing selected teams once chosen
def drawing(n_lottery_teams):
    order = []
    for i in range(n_lottery_teams):
        N = float(sum(LOTTO_BALLS.values()))
        draw = choice(list(LOTTO_BALLS.keys()), 1, p=[LOTTO_BALLS[c] / N for c in LOTTO_BALLS])[0]
        order.append(team_names[draw])
        del LOTTO_BALLS[draw]
    remaining = LOTTO_BALLS.keys()
    for r in remaining: order.append(team_names[r])
    return order

    
def dramatic_reveal(order, gibberish_time=2):
    time = gibberish_time
    print('\n\n\n')
    for i, result in enumerate(reversed(order)):
        if not skip_animation:
            print_gibberish(time)
        sys.stdout.write('\r')
        sys.stdout.flush()
        print('#%d:\t%s' % (len(order)-i, result))
        if i > 2 and i < 9: wait('space') # wait until spacebar is hit to continue
        time += 0.2 # get more dramatic with each result
    print('\n\n\n')


#plot_distribution()
order = drawing(2)
dramatic_reveal(order)





